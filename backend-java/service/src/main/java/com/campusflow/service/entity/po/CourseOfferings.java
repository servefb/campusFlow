package com.campusflow.service.entity.po;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import java.time.LocalDateTime;
import java.io.Serializable;

/**
 * <p>
 * 
 * </p>
 *
 * @author JIA
 * @since 2026-10-12
 */
@TableName("course_offerings")
public class CourseOfferings implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private Long courseId;

    private Long termId;

    /**
     * 教学班号，如 01、02
     */
    private String sectionNo;

    /**
     * 任课教师，对应 users.id（role = teacher）
     */
    private Long teacherUserId;

    private String campus;

    private Integer capacity;

    /**
     * 有效选课人数，选课/退课事务内同步维护
     */
    private Integer enrolledCount;

    private String selectionStatus;

    private LocalDateTime selectionStartAt;

    private LocalDateTime selectionEndAt;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }
    public Long getCourseId() {
        return courseId;
    }

    public void setCourseId(Long courseId) {
        this.courseId = courseId;
    }
    public Long getTermId() {
        return termId;
    }

    public void setTermId(Long termId) {
        this.termId = termId;
    }
    public String getSectionNo() {
        return sectionNo;
    }

    public void setSectionNo(String sectionNo) {
        this.sectionNo = sectionNo;
    }
    public Long getTeacherUserId() {
        return teacherUserId;
    }

    public void setTeacherUserId(Long teacherUserId) {
        this.teacherUserId = teacherUserId;
    }
    public String getCampus() {
        return campus;
    }

    public void setCampus(String campus) {
        this.campus = campus;
    }
    public Integer getCapacity() {
        return capacity;
    }

    public void setCapacity(Integer capacity) {
        this.capacity = capacity;
    }
    public Integer getEnrolledCount() {
        return enrolledCount;
    }

    public void setEnrolledCount(Integer enrolledCount) {
        this.enrolledCount = enrolledCount;
    }
    public String getSelectionStatus() {
        return selectionStatus;
    }

    public void setSelectionStatus(String selectionStatus) {
        this.selectionStatus = selectionStatus;
    }
    public LocalDateTime getSelectionStartAt() {
        return selectionStartAt;
    }

    public void setSelectionStartAt(LocalDateTime selectionStartAt) {
        this.selectionStartAt = selectionStartAt;
    }
    public LocalDateTime getSelectionEndAt() {
        return selectionEndAt;
    }

    public void setSelectionEndAt(LocalDateTime selectionEndAt) {
        this.selectionEndAt = selectionEndAt;
    }
    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
    public LocalDateTime getDeletedAt() {
        return deletedAt;
    }

    public void setDeletedAt(LocalDateTime deletedAt) {
        this.deletedAt = deletedAt;
    }

    @Override
    public String toString() {
        return "CourseOfferings{" +
            "id=" + id +
            ", courseId=" + courseId +
            ", termId=" + termId +
            ", sectionNo=" + sectionNo +
            ", teacherUserId=" + teacherUserId +
            ", campus=" + campus +
            ", capacity=" + capacity +
            ", enrolledCount=" + enrolledCount +
            ", selectionStatus=" + selectionStatus +
            ", selectionStartAt=" + selectionStartAt +
            ", selectionEndAt=" + selectionEndAt +
            ", createdAt=" + createdAt +
            ", updatedAt=" + updatedAt +
            ", deletedAt=" + deletedAt +
        "}";
    }
}
