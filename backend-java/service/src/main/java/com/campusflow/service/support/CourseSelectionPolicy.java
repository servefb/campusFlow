package com.campusflow.service.support;

import com.campusflow.service.entity.po.CourseOfferings;
import com.campusflow.service.entity.vo.CourseSelectionVO;
import java.time.LocalDateTime;

/** 开课班列表与详情共用的操作资格判断。 */
public final class CourseSelectionPolicy {
    private CourseSelectionPolicy() {}

    public static CourseSelectionVO.CurrentUser evaluate(String role, String enrollmentStatus,
            CourseOfferings offering, LocalDateTime now) {
        if (!"student".equals(role)) {
            return new CourseSelectionVO.CurrentUser(null, false, false);
        }
        boolean windowOpen = isWindowOpen(offering, now);
        boolean selected = "selected".equals(enrollmentStatus);
        boolean canEnroll = windowOpen
                && (enrollmentStatus == null || "dropped".equals(enrollmentStatus))
                && offering.getCapacity() != null && offering.getEnrolledCount() != null
                && offering.getCapacity() > offering.getEnrolledCount();
        return new CourseSelectionVO.CurrentUser(enrollmentStatus, canEnroll, selected && windowOpen);
    }

    public static boolean isWindowOpen(CourseOfferings offering, LocalDateTime now) {
        return "open".equals(offering.getSelectionStatus())
                && offering.getSelectionStartAt() != null
                && offering.getSelectionEndAt() != null
                && !now.isBefore(offering.getSelectionStartAt())
                && !now.isAfter(offering.getSelectionEndAt());
    }
}
