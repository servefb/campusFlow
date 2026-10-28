package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.po.KnowledgeCategories;
import com.campusflow.service.entity.po.KnowledgeDocuments;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.entity.vo.KnowledgeCategoriesVo;
import com.campusflow.service.mapper.KnowledgeCategoriesMapper;
import com.campusflow.service.mapper.KnowledgeDocumentsMapper;
import com.campusflow.service.service.IKnowledgeCategoriesService;
import com.campusflow.service.support.KnowledgeVisibility;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.AllArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * <p>
 * 服务实现类
 * </p>
 *
 * <h3>2026-10-15 修了什么</h3>
 * 分类的 {@code document_count} 此前是一条不过滤任何条件的
 * {@code SELECT category_id, COUNT(*) ... GROUP BY category_id}：软删的、下线的、
 * 归档的、解析失败的、当前用户根本看不见的，全算进数字里。
 * 用户看着「教务与培养管理（86）」点进去只有 3 篇 —— 计数和列表对不上，比没有计数更糟。
 * 现在按<b>该用户实际可见的范围</b>统计（未删除 + 普通用户仅 ready + 可见性白名单），
 * admin 仍看全量（治理页需要）。
 *
 * @author JIA
 * @since 2026-09-04
 */
@Service
@AllArgsConstructor
public class KnowledgeCategoriesServiceImpl extends ServiceImpl<KnowledgeCategoriesMapper, KnowledgeCategories> implements IKnowledgeCategoriesService {


    private KnowledgeDocumentsMapper knowledgeDocumentsMapper;

    /** 用户侧「谁可见」的唯一判定点（计数范围与列表/详情同源）。 */
    private KnowledgeVisibility knowledgeVisibility;

    @Override
    public Result<KnowledgeCategoriesVo> getKnowledgeCategories() {
        Users user = knowledgeVisibility.requireUser();
        List<KnowledgeCategories> knowledgeCategoriesList = lambdaQuery()
                .eq(KnowledgeCategories::getIsActive, true).list();


        List<Long> ids = knowledgeCategoriesList.stream().map(KnowledgeCategories::getId).filter(Objects::nonNull).toList();

        Map<Long, Long> collect = countVisibleDocuments(ids, user);

        List<KnowledgeCategoriesVo.KnowledgeCategoriesDetail> knowledgeCategoriesVoList = new ArrayList<>();
        knowledgeCategoriesList.forEach(knowledgeCategories -> {
            KnowledgeCategoriesVo.KnowledgeCategoriesDetail knowledgeCategoriesVo = new KnowledgeCategoriesVo.KnowledgeCategoriesDetail();
            knowledgeCategoriesVo.setId(knowledgeCategories.getId());
            knowledgeCategoriesVo.setName(knowledgeCategories.getName());
            knowledgeCategoriesVo.setDocument_count(collect.getOrDefault(knowledgeCategories.getId(), 0L));
            knowledgeCategoriesVoList.add(knowledgeCategoriesVo);
        });

        KnowledgeCategoriesVo knowledgeCategoriesVo = new KnowledgeCategoriesVo();
        knowledgeCategoriesVo.setItems(knowledgeCategoriesVoList);
        return new Result<KnowledgeCategoriesVo>().success(knowledgeCategoriesVo);
    }

    /**
     * 按「该用户实际能看到的文档」统计每个分类的文档数。
     *
     * <p>与列表接口同一套口径：未软删是底线；普通用户再加 {@code status='ready'} 与
     * {@link KnowledgeVisibility} 的可见性白名单；admin 只过滤软删（治理页要看全量）。
     * 一次 GROUP BY 拿全部分类，别逐分类 count。
     */
    private Map<Long, Long> countVisibleDocuments(List<Long> ids, Users user) {
        if (ids == null || ids.isEmpty()) {
            return Map.of();
        }
        /*
         * 用 QueryWrapper 而不是 LambdaQueryWrapper：COUNT(*) 这类原生聚合
         * select 写不了 lambda 列引用。可见性条件经 applyQueryRaw 注入，
         * 与列表接口的 applyQuery 是同一语义（两处并排、同步义务写在注释里）。
         */
        QueryWrapper<KnowledgeDocuments> wrapper = new QueryWrapper<>();
        wrapper.select("category_id AS category_id", "COUNT(*) AS document_count")
                .in("category_id", ids)
                .isNull("deleted_at");
        if (!knowledgeVisibility.isAdmin(user)) {
            wrapper.eq("status", "ready");
            knowledgeVisibility.applyQueryRaw(wrapper, user);
        }
        wrapper.groupBy("category_id");

        Map<Long, Long> counts = new HashMap<>();
        for (Map<String, Object> row : knowledgeDocumentsMapper.selectMaps(wrapper)) {
            Object categoryId = value(row, "category_id");
            Object documentCount = value(row, "document_count");
            if (categoryId instanceof Number category && documentCount instanceof Number count) {
                counts.put(category.longValue(), count.longValue());
            }
        }
        return counts;
    }

    /** 不区分大小写地从结果行里取值（列标签大小写由 JDBC 驱动决定，同 KnowledgeDocumentsServiceImpl）。 */
    private static Object value(Map<String, Object> row, String key) {
        if (row == null) {
            return null;
        }
        for (Map.Entry<String, Object> entry : row.entrySet()) {
            if (entry.getKey().equalsIgnoreCase(key)) {
                return entry.getValue();
            }
        }
        return null;
    }
}
