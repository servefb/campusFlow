package com.campusflow.service.service.impl;

import com.campusflow.service.entity.po.CourseEnrollments;
import com.campusflow.service.mapper.CourseEnrollmentsMapper;
import com.campusflow.service.mapper.CourseOfferingsMapper;
import com.campusflow.service.service.ICourseEnrollmentsService;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import lombok.RequiredArgsConstructor;
import java.util.List;

/**
 * <p>
 *  服务实现类
 * </p>
 *
 * @author JIA
 * @since 2026-10-12
 */
@Service
@RequiredArgsConstructor
public class CourseEnrollmentsServiceImpl extends ServiceImpl<CourseEnrollmentsMapper, CourseEnrollments> implements ICourseEnrollmentsService {

    private final CourseOfferingsMapper courseOfferingsMapper;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public int saveBatchAndUpdateEnrolled(List<CourseEnrollments> enrollments, Long termId) {
        if (enrollments.isEmpty()) {
            return 0;
        }
        if (!saveBatch(enrollments)) {
            throw new IllegalStateException("批量保存选课记录失败");
        }
        List<Long> offeringIds = enrollments.stream()
                .map(CourseEnrollments::getOfferingId).distinct().sorted().toList();
        return courseOfferingsMapper.updateEnrolled(offeringIds, termId);
    }
}
