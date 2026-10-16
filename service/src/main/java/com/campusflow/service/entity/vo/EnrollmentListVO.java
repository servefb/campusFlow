package com.campusflow.service.entity.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;


@Data
public class EnrollmentListVO {

    private List<Item> items;

    /**
     * 列表项：一条选课记录
     */
    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class Item {
        private Long enrollment_id;
        private String enrollment_status;
        private String selected_at;
        private String final_grade;
        private Offering offering;
    }

    /**
     * 开课信息
     */
    @Data
    @AllArgsConstructor
    public static class Offering {
        private Long id;
        private Course course;
        private String section_no;
        private Teacher teacher;
        private List<Schedule> schedules;

        public Offering(Long id) {
            this.id = id;
        }
    }

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
}