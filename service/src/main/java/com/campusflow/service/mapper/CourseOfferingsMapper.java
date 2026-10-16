package com.campusflow.service.mapper;

import com.campusflow.service.entity.po.CourseOfferings;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * <p>
 *  Mapper 接口
 * </p>
 *
 * @author JIA
 * @since 2026-10-12
 */
public interface CourseOfferingsMapper extends BaseMapper<CourseOfferings> {

    @Select("SELECT * FROM course_offerings WHERE id = #{id} FOR UPDATE")
    CourseOfferings selectForUpdate(@Param("id") Long id);

    @Update("UPDATE course_offerings SET enrolled_count = enrolled_count - 1, updated_at = #{now} " +
            "WHERE id = #{id} AND enrolled_count > 0")
    int decrementEnrolled(@Param("id") Long id, @Param("now") java.time.LocalDateTime now);


    @Update("<script>" +
            "UPDATE `course_offerings` AS co " +
            "SET co.`enrolled_count` = ( " +
            "    SELECT COUNT(*) " +
            "    FROM `course_enrollments` AS ce " +
            "    WHERE ce.`offering_id` = co.`id` " +
            "      AND ce.`status` = 'selected' " +
            ") " +
            "WHERE co.`id` IN " +
            "<foreach collection='offeringIds' item='id' open='(' separator=',' close=')'>" +
            "    #{id} " +
            "</foreach>" +
            "AND co.`term_id` = #{termId}" +
            "</script>")
    int updateEnrolled(@Param("offeringIds") List<Long> offeringIds, @Param("termId") Long termId);
}
