package com.campusflow.service.entity.po;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import java.io.Serializable;

/**
 * <p>
 * 
 * </p>
 *
 * @author JIA
 * @since 2026-10-12
 */
@TableName("course_prerequisites")
public class CoursePrerequisites implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "course_id", type = IdType.AUTO)
    private Long courseId;

    private Long prerequisiteCourseId;

    public Long getCourseId() {
        return courseId;
    }

    public void setCourseId(Long courseId) {
        this.courseId = courseId;
    }
    public Long getPrerequisiteCourseId() {
        return prerequisiteCourseId;
    }

    public void setPrerequisiteCourseId(Long prerequisiteCourseId) {
        this.prerequisiteCourseId = prerequisiteCourseId;
    }

    @Override
    public String toString() {
        return "CoursePrerequisites{" +
            "courseId=" + courseId +
            ", prerequisiteCourseId=" + prerequisiteCourseId +
        "}";
    }
}
