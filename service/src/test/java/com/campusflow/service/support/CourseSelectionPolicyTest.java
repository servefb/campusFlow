package com.campusflow.service.support;

import com.campusflow.service.entity.po.CourseOfferings;
import org.junit.jupiter.api.Test;
import java.time.LocalDateTime;
import static org.junit.jupiter.api.Assertions.*;

class CourseSelectionPolicyTest {
    private final LocalDateTime now = LocalDateTime.of(2026, 10, 13, 12, 0);

    private CourseOfferings openOffering() {
        CourseOfferings offering = new CourseOfferings();
        offering.setSelectionStatus("open");
        offering.setSelectionStartAt(now.minusDays(1));
        offering.setSelectionEndAt(now.plusDays(1));
        offering.setCapacity(20);
        offering.setEnrolledCount(10);
        return offering;
    }

    @Test
    void teachersAndAdminsCannotEnrollOrDrop() {
        for (String role : new String[]{"teacher", "admin"}) {
            var state = CourseSelectionPolicy.evaluate(role, "selected", openOffering(), now);
            assertNull(state.getEnrollment_status());
            assertFalse(state.getCan_enroll());
            assertFalse(state.getCan_drop());
        }
    }

    @Test
    void unselectedAndDroppedStudentsMayEnroll() {
        for (String status : new String[]{null, "dropped"}) {
            var state = CourseSelectionPolicy.evaluate("student", status, openOffering(), now);
            assertEquals(status, state.getEnrollment_status());
            assertTrue(state.getCan_enroll());
            assertFalse(state.getCan_drop());
        }
    }

    @Test
    void onlySelectedStudentsMayDrop() {
        var selected = CourseSelectionPolicy.evaluate("student", "selected", openOffering(), now);
        assertFalse(selected.getCan_enroll());
        assertTrue(selected.getCan_drop());
        var completed = CourseSelectionPolicy.evaluate("student", "completed", openOffering(), now);
        assertFalse(completed.getCan_enroll());
        assertFalse(completed.getCan_drop());
    }

    @Test
    void fullClassBlocksEnrollmentButAllowsDrop() {
        var offering = openOffering();
        offering.setEnrolledCount(20);
        assertFalse(CourseSelectionPolicy.evaluate("student", null, offering, now).getCan_enroll());
        assertTrue(CourseSelectionPolicy.evaluate("student", "selected", offering, now).getCan_drop());
    }

    @Test
    void outsideWindowBlocksBothActions() {
        for (LocalDateTime time : new LocalDateTime[]{now.minusDays(2), now.plusDays(2)}) {
            assertFalse(CourseSelectionPolicy.evaluate("student", null, openOffering(), time).getCan_enroll());
            assertFalse(CourseSelectionPolicy.evaluate("student", "selected", openOffering(), time).getCan_drop());
        }
    }

    @Test
    void closedOrUnconfiguredWindowBlocksActions() {
        var offering = openOffering();
        offering.setSelectionStatus("closed");
        assertFalse(CourseSelectionPolicy.evaluate("student", null, offering, now).getCan_enroll());
        assertFalse(CourseSelectionPolicy.evaluate("student", "selected", offering, now).getCan_drop());
        offering.setSelectionStatus("open");
        offering.setSelectionStartAt(null);
        assertFalse(CourseSelectionPolicy.evaluate("student", null, offering, now).getCan_enroll());
    }
}
