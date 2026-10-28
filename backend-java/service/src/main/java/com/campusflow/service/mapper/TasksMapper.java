package com.campusflow.service.mapper;

import com.campusflow.service.entity.po.Tasks;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
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
public interface TasksMapper extends BaseMapper<Tasks> {


    @Select(" SELECT status,count(*) total from tasks where  user_id=${userId} group by (status);")
    List<Map<String, Object>> getTasksSummary(Long userId);
}
