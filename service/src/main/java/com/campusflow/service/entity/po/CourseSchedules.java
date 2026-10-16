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
@TableName("course_schedules")
public class CourseSchedules implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private Long offeringId;

    /**
     * 1 = 周一，7 = 周日
     */
    private Integer weekday;

    /**
     * 第几节课开始，从 1 计
     */
    private Integer startPeriod;

    private Integer endPeriod;

    /**
     * 周次，如 1-16、1-8 单、9-16 双
     */
    private String weekRange;

    private String location;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }
    public Long getOfferingId() {
        return offeringId;
    }

    public void setOfferingId(Long offeringId) {
        this.offeringId = offeringId;
    }
    public Integer getWeekday() {
        return weekday;
    }

    public void setWeekday(Integer weekday) {
        this.weekday = weekday;
    }
    public Integer getStartPeriod() {
        return startPeriod;
    }

    public void setStartPeriod(Integer startPeriod) {
        this.startPeriod = startPeriod;
    }
    public Integer getEndPeriod() {
        return endPeriod;
    }

    public void setEndPeriod(Integer endPeriod) {
        this.endPeriod = endPeriod;
    }
    public String getWeekRange() {
        return weekRange;
    }

    public void setWeekRange(String weekRange) {
        this.weekRange = weekRange;
    }
    public String getLocation() {
        return location;
    }

    public void setLocation(String location) {
        this.location = location;
    }

    @Override
    public String toString() {
        return "CourseSchedules{" +
            "id=" + id +
            ", offeringId=" + offeringId +
            ", weekday=" + weekday +
            ", startPeriod=" + startPeriod +
            ", endPeriod=" + endPeriod +
            ", weekRange=" + weekRange +
            ", location=" + location +
        "}";
    }
}
