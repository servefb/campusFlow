package com.campusflow.service.mapper;

import com.campusflow.service.entity.po.Files;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Update;

/**
 * <p>
 *  Mapper 接口
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface FilesMapper extends BaseMapper<Files> {


    @Update("update files set status = #{scanning} where id = #{id}")
    Integer updateStatusById(Long id, String scanning);
}
