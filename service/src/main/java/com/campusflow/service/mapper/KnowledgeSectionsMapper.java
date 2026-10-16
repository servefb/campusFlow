package com.campusflow.service.mapper;

import com.campusflow.service.entity.po.KnowledgeSections;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.campusflow.service.entity.vo.KnowledgeChapterVo;
import org.apache.ibatis.annotations.Select;
import org.springframework.security.config.web.server.ServerSecurityMarker;

import java.util.List;

/**
 * <p>
 *  Mapper 接口
 * </p>
 *
 * @author JI*/
public interface KnowledgeSectionsMapper extends BaseMapper<KnowledgeSections> {

    @Select("SELECT chapter_no, article_no, id, heading as title\n" +
            "FROM knowledge_sections\n" +
            "WHERE version_id = #{id}\n" +
            " ORDER BY chapter_no, article_no, chunk_index")
    List<KnowledgeChapterVo.Response> getKnowledgeSections(Long id);
}
