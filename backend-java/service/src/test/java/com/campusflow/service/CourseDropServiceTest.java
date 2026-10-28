package com.campusflow.service;

import com.campusflow.common.context.UserContext;
import com.campusflow.service.entity.po.*;
import com.campusflow.service.exception.CourseOperationException;
import com.campusflow.service.mapper.CourseEnrollmentsMapper;
import com.campusflow.service.mapper.CourseOfferingsMapper;
import com.campusflow.service.service.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.*;

import java.time.LocalDateTime;
import java.time.ZoneId;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CourseDropServiceTest {
    private final CourseOfferingsMapper offerings = mock(CourseOfferingsMapper.class);
    private final CourseEnrollmentsMapper enrollments = mock(CourseEnrollmentsMapper.class);
    private final IAcademicTermsService terms = mock(IAcademicTermsService.class);
    private final IUsersService users = mock(IUsersService.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final CourseDropService service = new CourseDropService(offerings, enrollments, terms, users, redis);
    private CourseOfferings offering;
    private CourseEnrollments enrollment;
    private TestTransactionManager manager;
    private TransactionTemplate transaction;

    @BeforeEach
    void setUp() {
        UserContext.setUserId(18L);
        Users student = new Users();
        student.setRole("student");
        when(users.getById(18L)).thenReturn(student);
        LocalDateTime now = LocalDateTime.now(ZoneId.of("Asia/Shanghai"));
        offering = new CourseOfferings();
        offering.setId(501L);
        offering.setCourseId(101L);
        offering.setTermId(3L);
        offering.setCapacity(120);
        offering.setEnrolledCount(99);
        offering.setSelectionStatus("open");
        offering.setSelectionStartAt(now.minusDays(1));
        offering.setSelectionEndAt(now.plusDays(1));
        when(offerings.selectForUpdate(501L)).thenReturn(offering);
        AcademicTerms term = new AcademicTerms();
        term.setTermCode("2026Fall");
        when(terms.getById(3L)).thenReturn(term);
        enrollment = new CourseEnrollments();
        enrollment.setId(9001L);
        enrollment.setStatus("selected");
        when(enrollments.selectLatestForUpdate(18L, 501L)).thenReturn(enrollment);
        when(enrollments.dropSelected(eq(9001L), any())).thenReturn(1);
        when(offerings.decrementEnrolled(eq(501L), any())).thenReturn(1);
        manager = new TestTransactionManager();
        transaction = new TransactionTemplate(manager);
        doAnswer(invocation -> {
            assertTrue(manager.committed, "Redis 名额必须在数据库提交后才释放");
            return 1L;
        }).when(redis).execute(any(DefaultRedisScript.class), anyList(), eq("501"),
                eq("campusflow:offering:bitmap:{2026Fall}:"));
    }

    @AfterEach
    void cleanUp() {
        UserContext.clear();
    }

    private void expectFailure(int status, String reason, String termCode) {
        CourseOperationException error = assertThrows(CourseOperationException.class,
                () -> transaction.execute(s -> service.dropCourse(101L, 501L, termCode)));
        assertEquals(status, error.getHttpStatus());
        assertEquals(reason, error.getReason());
        assertTrue(manager.rolledBack);
        verifyNoInteractions(redis);
    }

    @Test
    void successfulDropCommitsBeforeReleasingReservation() {
        var result = transaction.execute(s -> service.dropCourse(101L, 501L, "2026Fall"));
        assertNotNull(result);
        assertEquals("dropped", result.enrollment_status());
        assertEquals(98, result.enrolled_count());
        assertEquals(22, result.remaining());
        verify(enrollments).dropSelected(eq(9001L), any(LocalDateTime.class));
        verify(offerings).decrementEnrolled(eq(501L), any(LocalDateTime.class));
        verify(redis).execute(any(DefaultRedisScript.class), eq(java.util.List.of(
                "campusflow:student:selected:{2026Fall}:18",
                "campusflow:student:offering:bitmap:{2026Fall}:18",
                "campusflow:course:store:{2026Fall}:501",
                "campusflow:tmp:bitmap:{2026Fall}:drop:18")), eq("501"),
                eq("campusflow:offering:bitmap:{2026Fall}:"));
    }

    @Test
    void missingTermIsBadRequest() {
        expectFailure(400, "invalid_parameter", null);
        verifyNoInteractions(offerings, enrollments);
    }

    @Test
    void teacherCannotDrop() {
        Users teacher = new Users();
        teacher.setRole("teacher");
        when(users.getById(18L)).thenReturn(teacher);
        expectFailure(403, "permission_denied", "2026Fall");
        verifyNoInteractions(offerings, enrollments);
    }

    @Test
    void wrongCourseOrTermIsNotFound() {
        offering.setCourseId(999L);
        expectFailure(404, "offering_not_found", "2026Fall");
        offering.setCourseId(101L);
        expectFailure(404, "offering_not_found", "2026-2027-1");
        verifyNoInteractions(enrollments);
    }

    @Test
    void missingOfferingIsNotFound() {
        when(offerings.selectForUpdate(501L)).thenReturn(null);
        expectFailure(404, "offering_not_found", "2026Fall");
    }

    @Test
    void closedWindowDoesNotWrite() {
        offering.setSelectionStatus("closed");
        expectFailure(409, "selection_not_open", "2026Fall");
        verifyNoInteractions(enrollments);
    }

    @Test
    void expiredWindowDoesNotWrite() {
        offering.setSelectionEndAt(LocalDateTime.now(ZoneId.of("Asia/Shanghai")).minusHours(1));
        expectFailure(409, "selection_not_open", "2026Fall");
    }

    @Test
    void repeatedDropDoesNotDecrementAgain() {
        enrollment.setStatus("dropped");
        expectFailure(409, "not_enrolled", "2026Fall");
        verify(offerings, never()).decrementEnrolled(anyLong(), any());
        verify(enrollments, never()).dropSelected(anyLong(), any());
    }

    @Test
    void neverEnrolledDoesNotDecrement() {
        when(enrollments.selectLatestForUpdate(18L, 501L)).thenReturn(null);
        expectFailure(409, "not_enrolled", "2026Fall");
        verify(offerings, never()).decrementEnrolled(anyLong(), any());
    }

    @Test
    void invalidCountRollsBackWithoutReleasingRedis() {
        when(offerings.decrementEnrolled(eq(501L), any())).thenReturn(0);
        expectFailure(500, "enrollment_count_invalid", "2026Fall");
    }

    @Test
    void redisFailureReportsCommittedDatabaseState() {
        doThrow(new IllegalStateException("Redis unavailable")).when(redis)
                .execute(any(DefaultRedisScript.class), anyList(), eq("501"),
                        eq("campusflow:offering:bitmap:{2026Fall}:"));
        var error = assertThrows(CourseOperationException.class,
                () -> transaction.execute(s -> service.dropCourse(101L, 501L, "2026Fall")));
        assertEquals(503, error.getHttpStatus());
        assertEquals("reservation_sync_failed", error.getReason());
        assertTrue(manager.committed);
        assertFalse(manager.rolledBack);
    }

    private static class TestTransactionManager extends AbstractPlatformTransactionManager {
        boolean committed;
        boolean rolledBack;
        @Override protected Object doGetTransaction() { return new Object(); }
        @Override protected void doBegin(Object tx, TransactionDefinition definition) {}
        @Override protected void doCommit(DefaultTransactionStatus status) { committed = true; }
        @Override protected void doRollback(DefaultTransactionStatus status) { rolledBack = true; }
    }
}
