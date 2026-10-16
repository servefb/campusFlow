package com.campusflow.service.mapper;

import com.campusflow.service.entity.po.CampusNews;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.campusflow.service.entity.vo.GetHomeNewsVo;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

/**
 * <p>
 * Mapper 接口
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface CampusNewsMapper extends BaseMapper<CampusNews> {

    @Select("SELECT category,count(*) as 'count' FROM campus_news where status='published' group by category")
    List<Map<String, Object>> getCategory();

}
