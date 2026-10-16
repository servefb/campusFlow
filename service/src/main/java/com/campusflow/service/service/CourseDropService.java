package com.campusflow.service.service;

import com.campusflow.common.context.UserContext;
import com.campusflow.service.entity.po.AcademicTerms;
import com.campusflow.service.entity.po.CourseEnrollments;
import com.campusflow.service.entity.po.CourseOfferings;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.entity.vo.CourseDropVO;
import com.campusflow.service.exception.CourseOperationException;
import com.campusflow.service.mapper.CourseEnrollmentsMapper;
import com.campusflow.service.mapper.CourseOfferingsMapper;
import com.campusflow.service.support.CourseSelectionPolicy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Objects;

import static com.campusflow.service.service.impl.CoursesServiceImpl.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class CourseDropService {
    private final CourseOfferingsMapper offeringsMapper;
    private final CourseEnrollmentsMapper enrollmentsMapper;
    private final IAcademicTermsService termsService;
    private final IUsersService usersService;
    private final StringRedisTemplate redis;

    @Transactional(rollbackFor = Exception.class)
    public CourseDropVO dropCourse(Long courseId, Long offeringId, String termCode) {
        if (termCode == null || termCode.isBlank()) {
            throw new CourseOperationException(400, 40001, "term_code 必传", "invalid_parameter");
        }
        Long userId = UserContext.getUserId();
        Users user = userId == null ? null : usersService.getById(userId);
        if (user == null || !"student".equals(user.getRole())) {
            throw new CourseOperationException(403, 40300, "仅学生可退课", "permission_denied");
        }
        // Lock the class first so repeated/concurrent drops cannot decrement twice.
        CourseOfferings offering = offeringsMapper.selectForUpdate(offeringId);
        if (offering == null || !Objects.equals(courseId, offering.getCourseId())) {
            throw notFound();
        }
        AcademicTerms term = termsService.getById(offering.getTermId());
        if (term == null || !termCode.equals(term.getTermCode())) {
            throw notFound();
        }
        LocalDateTime now = LocalDateTime.now(ZoneId.of("Asia/Shanghai"));
        if (!CourseSelectionPolicy.isWindowOpen(offering, now)) {
            throw new CourseOperationException(409, 40900, "不在开放退课窗口内", "selection_not_open");
        }
        CourseEnrollments enrollment = enrollmentsMapper.selectLatestForUpdate(userId, offeringId);
        if (enrollment == null || !"selected".equals(enrollment.getStatus())) {
            throw notEnrolled();
        }
        if (enrollmentsMapper.dropSelected(enrollment.getId(), now) != 1) {
            throw notEnrolled();
        }
        if (offeringsMapper.decrementEnrolled(offeringId, now) != 1) {
            throw new CourseOperationException(500, 50000, "选课人数异常，退课已回滚", "enrollment_count_invalid");
        }
        // Do not release the Redis reservation if the database transaction rolls back.
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                releaseReservation(termCode, offeringId, userId);
            }
        });
        int enrolled = offering.getEnrolledCount() - 1;
        return new CourseDropVO(offeringId, "dropped", enrolled, offering.getCapacity() - enrolled);
    }

    private void releaseReservation(String termCode, Long offeringId, Long userId) {
        String tag = "{" + termCode + "}:";
        DefaultRedisScript<Long> script = new DefaultRedisScript<>();
        script.setLocation(new ClassPathResource("lua/dropCourse.lua"));
        script.setResultType(Long.class);
        try {
            Long result = redis.execute(script, List.of(
                    STUDENT_SELECTED + tag + userId,
                    STUDENT_OFFERING_BITMAP + tag + userId,
                    COURSE_STORE + tag + offeringId,
                    TMP_BITMAP + tag + "drop:" + userId),
                    offeringId.toString(), OFFERING_BITMAP + tag);
            if (result == null || result < 0) {
                throw new IllegalStateException("剩余课程位图缺失或库存数据异常");
            }
        } catch (RuntimeException e) {
            log.error("退课数据库已提交，但 Redis 释放失败：termCode={}, offeringId={}, userId={}",
                    termCode, offeringId, userId, e);
            throw new CourseOperationException(503, 50300,
                    "退课已落库，但名额同步失败，请刷新课表并联系管理员", "reservation_sync_failed");
        }
    }

    private CourseOperationException notFound() {
        return new CourseOperationException(404, 40400, "开课班不存在或课程、学期不匹配", "offering_not_found");
    }

    private CourseOperationException notEnrolled() {
        return new CourseOperationException(409, 40900, "当前未选该开课班", "not_enrolled");
    }
}
