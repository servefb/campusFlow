package com.campusflow.service.entity.vo;

import lombok.AllArgsConstructor;
import lombok.Data;


import java.util.List;


@Data
public class CourseSelectionVO  {
    private Long id;
    private Course course;
    private Term term;
    private String section_no;
    private Teacher teacher;
    private String campus;
    private Integer capacity;
    private Integer enrolled_count;
    private Integer remaining;
    private String selection_status;
    private String selection_start_at;
    private String selection_end_at;
    private List<Schedule> schedules;
    private CurrentUser current_user;

    // ==================== 内部类 ====================

    /**
     * 课程信息
     */
    @Data
    @AllArgsConstructor
    public static class Course {
        private Long id;
        private String course_code;
        private String name;
        private Double credit;
    }

    /**
     * 学期信息
     */
    @Data
    @AllArgsConstructor
    public static class Term {
        private Long id;
        private String code;
        private String name;
    }

    /**
     * 教师信息
     */
    @Data
    @AllArgsConstructor
    public static class Teacher {
        private Long id;
        private String name;
    }

    /**
     * 上课时间安排
     */
    @Data
    @AllArgsConstructor
    public static class Schedule {
        private Integer weekday;
        private Integer start_period;
        private Integer end_period;
        private String week_range;
        private String location;
    }

    /**
     * 当前用户对该教学班的选课状态
     */
    @Data
    @AllArgsConstructor
    public static class CurrentUser {
        private String enrollment_status;
        private Boolean can_enroll;
        private Boolean can_drop;
    }
}
