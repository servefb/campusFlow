package com.campusflow.service.entity.po;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import java.time.LocalDate;
import com.baomidou.mybatisplus.annotation.TableId;
import java.time.LocalDateTime;
import java.io.Serializable;

/**
 * <p>
 * 学期表
 * </p>
 *
 * @author JIA
 * @since 2026-10-13
 */
@TableName("academic_terms")
public class AcademicTerms implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 主键ID
     */
    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    /**
     * 学期编码，如 2026Fall（用于Redis Hash Tag）
     */
    private String termCode;

    /**
     * 学期名称，如 2026-2027学年第一学期
     */
    private String termName;

    /**
     * 学期开始日期
     */
    private LocalDate startDate;

    /**
     * 学期结束日期
     */
    private LocalDate endDate;

    /**
     * 总周数（用于动态计算位图大小）
     */
    private Integer weekCount;

    /**
     * 每天节数（用于动态计算位图大小）
     */
    private Integer periodsPerDay;

    /**
     * 全局选课开始时间
     */
    private LocalDateTime selectionStartTime;

    /**
     * 全局选课结束时间
     */
    private LocalDateTime selectionEndTime;

    /**
     * 学期状态：0-未开始，1-进行中，2-已结束
     */
    private Integer status;

    /**
     * 是否当前学期：0-否，1-是（全局唯一）
     */
    private Integer isCurrent;

    /**
     * 创建时间
     */
    private LocalDateTime createTime;

    /**
     * 更新时间
     */
    private LocalDateTime updateTime;

    /**
     * 逻辑删除：0-未删除，1-已删除
     */
    private Integer deleted;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }
    public String getTermCode() {
        return termCode;
    }

    public void setTermCode(String termCode) {
        this.termCode = termCode;
    }
    public String getTermName() {
        return termName;
    }

    public void setTermName(String termName) {
        this.termName = termName;
    }
    public LocalDate getStartDate() {
        return startDate;
    }

    public void setStartDate(LocalDate startDate) {
        this.startDate = startDate;
    }
    public LocalDate getEndDate() {
        return endDate;
    }

    public void setEndDate(LocalDate endDate) {
        this.endDate = endDate;
    }
    public Integer getWeekCount() {
        return weekCount;
    }

    public void setWeekCount(Integer weekCount) {
        this.weekCount = weekCount;
    }
    public Integer getPeriodsPerDay() {
        return periodsPerDay;
    }

    public void setPeriodsPerDay(Integer periodsPerDay) {
        this.periodsPerDay = periodsPerDay;
    }
    public LocalDateTime getSelectionStartTime() {
        return selectionStartTime;
    }

    public void setSelectionStartTime(LocalDateTime selectionStartTime) {
        this.selectionStartTime = selectionStartTime;
    }
    public LocalDateTime getSelectionEndTime() {
        return selectionEndTime;
    }

    public void setSelectionEndTime(LocalDateTime selectionEndTime) {
        this.selectionEndTime = selectionEndTime;
    }
    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }
    public Integer getIsCurrent() {
        return isCurrent;
    }

    public void setIsCurrent(Integer isCurrent) {
        this.isCurrent = isCurrent;
    }
    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }
    public LocalDateTime getUpdateTime() {
        return updateTime;
    }

    public void setUpdateTime(LocalDateTime updateTime) {
        this.updateTime = updateTime;
    }
    public Integer getDeleted() {
        return deleted;
    }

    public void setDeleted(Integer deleted) {
        this.deleted = deleted;
    }

    @Override
    public String toString() {
        return "AcademicTerms{" +
            "id=" + id +
            ", termCode=" + termCode +
            ", termName=" + termName +
            ", startDate=" + startDate +
            ", endDate=" + endDate +
            ", weekCount=" + weekCount +
            ", periodsPerDay=" + periodsPerDay +
            ", selectionStartTime=" + selectionStartTime +
            ", selectionEndTime=" + selectionEndTime +
            ", status=" + status +
            ", isCurrent=" + isCurrent +
            ", createTime=" + createTime +
            ", updateTime=" + updateTime +
            ", deleted=" + deleted +
        "}";
    }
}
