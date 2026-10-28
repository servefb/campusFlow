package com.campusflow.service.mapper;

import com.campusflow.service.entity.po.CourseEnrollments;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import java.time.LocalDateTime;

/**
 * <p>
 *  Mapper 接口
 * </p>
 *
 * @author JIA
 * @since 2026-10-12
 */
public interface CourseEnrollmentsMapper extends BaseMapper<CourseEnrollments> {

    @Select("SELECT * FROM course_enrollments WHERE user_id = #{userId} AND offering_id = #{offeringId} " +
            "ORDER BY id DESC LIMIT 1 FOR UPDATE")
    CourseEnrollments selectLatestForUpdate(@Param("userId") Long userId, @Param("offeringId") Long offeringId);

    @Update("UPDATE course_enrollments SET status = 'dropped', dropped_at = #{now}, updated_at = #{now} " +
            "WHERE id = #{id} AND status = 'selected'")
    int dropSelected(@Param("id") Long id, @Param("now") LocalDateTime now);

}
