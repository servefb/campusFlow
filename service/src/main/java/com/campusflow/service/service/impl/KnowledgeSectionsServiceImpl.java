package com.campusflow.service.service.impl;

import com.campusflow.common.exception.NotFoundException;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.po.KnowledgeDocumentVersions;
import com.campusflow.service.entity.po.KnowledgeSections;
import com.campusflow.service.entity.vo.KnowledgeChapterVo;
import com.campusflow.service.entity.vo.KnowledgeSectionContentVo;
import com.campusflow.service.mapper.KnowledgeSectionsMapper;
import com.campusflow.service.service.IKnowledgeDocumentVersionsService;
import com.campusflow.service.service.IKnowledgeSectionsService;
import com.campusflow.service.support.KnowledgeVisibility;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.campusflow.tools.NumberToChineseSimple;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jetbrains.annotations.NotNull;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * <p>
 * 服务实现类
 * </p>
 *
 * <h3>2026-10-15 修了什么</h3>
 * <ol>
 *   <li><b>补上可见性校验</b>：此前两个接口拿 documentId / sectionId 直接查，
 *       没有任何「谁可见」判断 —— 列表和详情能防住的越权，从章节 / 内容接口原样绕过去。
 *       现在统一走 {@link KnowledgeVisibility#requireVisibleDocument(Long)}
 *       （不可见 / 软删 / 未上线对普通用户一律 404 同一句话）；</li>
 *   <li><b>缺失的行从 500 变 404</b>：无版本 / 无章节 / 无 section 时老代码依次踩
 *       NPE（{@code version.getId()}）、空列表抛 {@code IllegalArgumentException}、
 *       NPE（{@code one.getVersionId()}）—— 全部落全局兜底回 500，
 *       前端按 404 走的「不存在」分支永远等不到；</li>
 *   <li><b>版本查询不再裸用 {@code .one()}</b>：一文档多版本时它抛
 *       {@code TooManyResultsException}，同样是 500。改成 is_current 优先、id 倒序取一条
 *       （与列表页 enrich 的选取规则一致）。</li>
 * </ol>
 *
 * @author JIA
 * @since 2026-09-04
 */
@Slf4j
@Service
@AllArgsConstructor
public class KnowledgeSectionsServiceImpl extends ServiceImpl<KnowledgeSectionsMapper, KnowledgeSections> implements IKnowledgeSectionsService {

    private IKnowledgeDocumentVersionsService knowledgeDocumentVersionsService;

    private KnowledgeSectionsMapper knowledgeSectionsMapper;

    /** 用户侧「谁可见」的唯一判定点；只经它取文档，别在这里散写 role 判断。 */
    private KnowledgeVisibility knowledgeVisibility;

    @Override
    public Result getChaptersByDocumentId(Long id) {

        // 可见性三道闸（不存在 / 软删 / 越权 / 未上线）都在里面，失败统一 404
        knowledgeVisibility.requireVisibleDocument(id);

        KnowledgeDocumentVersions knowledgeDocumentVersion = selectCurrentVersion(id);
        if (knowledgeDocumentVersion == null) {
            throw new NotFoundException("文档没有可用版本");
        }

        List<KnowledgeChapterVo.Response> knowledgeSectionsList = knowledgeSectionsMapper.getKnowledgeSections(knowledgeDocumentVersion.getId());
        if (knowledgeSectionsList == null || knowledgeSectionsList.isEmpty()) {
            throw new NotFoundException("章节不存在");
        }
        KnowledgeChapterVo knowledgeChapterVo = new KnowledgeChapterVo();
        knowledgeChapterVo.setDocument_id(id);
        List<KnowledgeChapterVo.ChapterItem> knowledgeChapterVoList = new ArrayList<>();
        Map<String, List<KnowledgeChapterVo.Section>> SectionMap = new HashMap<>();
        knowledgeSectionsList.forEach(knowledgeSections -> {
            Integer chapterNo = knowledgeSections.getChapterNo();
            if (chapterNo == null) {
                // 脏数据（章节号为空）跳过该行并留痕：不该让一条坏数据把整份目录变成 500
                log.warn("knowledge_sections 章节号为空，跳过：id={} version_id={}",
                        knowledgeSections.getId(), knowledgeDocumentVersion.getId());
                return;
            }
            KnowledgeChapterVo.ChapterItem chapterItem = new KnowledgeChapterVo.ChapterItem();
            KnowledgeChapterVo.Section section = new KnowledgeChapterVo.Section();
            if (!SectionMap.containsKey(chapterNo.toString())) {
                SectionMap.put(chapterNo.toString(), new ArrayList<KnowledgeChapterVo.Section>());
            }
            if (knowledgeSections.getArticleNo() == null) {
                chapterItem.setId(chapterNo.toString());
                chapterItem.setTitle(knowledgeSections.getTitle());
                chapterItem.setLabel("第" + NumberToChineseSimple.toChinese(chapterNo) + "章");
                chapterItem.setOrder(String.valueOf(chapterNo));
                knowledgeChapterVoList.add(chapterItem);
            } else {
                section.setId(knowledgeSections.getId().toString());
                section.setTitle(knowledgeSections.getTitle());
                section.setLabel("第" + NumberToChineseSimple.toChinese(knowledgeSections.getArticleNo()) + "条");
                SectionMap.get(chapterNo.toString()).add(section);
            }
        });
        knowledgeChapterVoList.forEach(chapterItem -> {
            chapterItem.setSections(SectionMap.get(chapterItem.getId()));
        });
        knowledgeChapterVo.setItems(knowledgeChapterVoList);
        return new Result<KnowledgeChapterVo>().success(knowledgeChapterVo);
    }

    @Override
    public Result getSectionsByDocumentIdAndSectionId(Long id, Long sectionId) {

        // 先验文档可见性：sectionId 属于哪篇文档是查出来的，不能信路径里的 id 就算数
        knowledgeVisibility.requireVisibleDocument(id);

        KnowledgeSections one = lambdaQuery().eq(KnowledgeSections::getId, sectionId).one();
        if (one == null) {
            throw new NotFoundException("章节内容不存在");
        }

        Long versionId = one.getVersionId();
        KnowledgeDocumentVersions byId = versionId == null ? null : knowledgeDocumentVersionsService.getById(versionId);
        // documentId 可空（历史数据），逐个判空后再比 —— 老代码 byId.getDocumentId().equals(id)
        // 在任一端为空时就是 NPE 500
        if (byId == null || byId.getDocumentId() == null || !byId.getDocumentId().equals(id)) {
            throw new NotFoundException("章节内容不存在");
        }

        KnowledgeSectionContentVo knowledgeSectionContentVo = getKnowledgeSectionContentVo(one, byId);
        return new Result<KnowledgeSectionContentVo>().success(knowledgeSectionContentVo);
    }

    /**
     * 当前版本：{@code is_current=1} 优先，其次 id 最大（最近写入）。
     *
     * <p>与列表页 enrich、详情页同一选取规则；不用 {@code .one()} 裸查（多版本 → 500）。
     */
    private KnowledgeDocumentVersions selectCurrentVersion(Long documentId) {
        List<KnowledgeDocumentVersions> versions = knowledgeDocumentVersionsService.lambdaQuery()
                .eq(KnowledgeDocumentVersions::getDocumentId, documentId)
                .orderByDesc(KnowledgeDocumentVersions::getIsCurrent)
                .orderByDesc(KnowledgeDocumentVersions::getId)
                .last("LIMIT 1")
                .list();
        return versions.isEmpty() ? null : versions.get(0);
    }

    @NotNull
    private static KnowledgeSectionContentVo getKnowledgeSectionContentVo(KnowledgeSections one, KnowledgeDocumentVersions byId) {
        KnowledgeSectionContentVo knowledgeSectionContentVo = new KnowledgeSectionContentVo();
        knowledgeSectionContentVo.setId(one.getId());
        knowledgeSectionContentVo.setDocumentId(byId.getDocumentId());
        knowledgeSectionContentVo.setChapterId(one.getChapterNo().longValue());
        knowledgeSectionContentVo.setLabel(one.getSectionLabel());
        knowledgeSectionContentVo.setTitle(one.getHeading());
        knowledgeSectionContentVo.setContent(one.getContent());
        knowledgeSectionContentVo.setSignatureVerified(byId.getSignatureVerified());
        knowledgeSectionContentVo.setVersion(byId.getVersionNo());
        return knowledgeSectionContentVo;
    }
}
