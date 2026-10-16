package com.campusflow.service.service;

import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.ConflictQueryDto;
import com.campusflow.service.entity.dto.ConflictResolveDto;
import com.campusflow.service.entity.dto.KnowledgeJobQueryDto;
import com.campusflow.service.entity.vo.DocumentActionVo;
import com.campusflow.service.entity.vo.KnowledgeConflictVo;
import com.campusflow.service.entity.vo.KnowledgeJobVo;

/**
 * 知识治理管理端 —— 契约文档 11.2 的 {@code /knowledge/admin/*}。
 *
 * <h3>为什么这一批接口此前完全不存在</h3>
 * MyBatis-Plus 生成器为这几张表（{@code knowledge_conflicts} / {@code knowledge_jobs} /
 * {@code knowledge_job_steps}）都生成了 {@code PO + Mapper + Service}，但对应的 Controller
 * 是**空壳**（只有一个 {@code @RequestMapping("/knowledge-conflicts")} 和一对花括号），
 * 而且路径是脚手架风格的「表名当路径」，与前端要的
 * {@code /knowledge/admin/conflicts} 对不上。
 * 于是管理端「上线 / 下线 / 处理冲突」三个按钮点下去全是
 * {@code 404 请求的接口不存在}（2026-09-23 逐条实测）。
 *
 * <p>所以本接口集做的不是「新建数据模型」，而是**把已有数据按管理台需要的形状暴露出来**：
 * 补 join（文档标题、处置人姓名）、补分页包络、补动作语义（幂等 / 状态机 / 409）。
 *
 * <h3>为什么不放在 {@code /knowledge-conflicts}</h3>
 * 那批脚手架路径是直接暴露表名的裸 CRUD（无鉴权、无包络、无分页），
 * 属于生成器残留。<b>不要</b>把管理端接口接到它们上面 ——
 * 一旦前端依赖了，将来想收权限或改字段都会牵动两个路径。
 *
 * <h3>不在本接口里的那个（重要）</h3>
 * {@code POST /knowledge/admin/documents/{id}/reindex} **不在 v1**：
 * 「重新解析 + 重建索引」要真的跑解析器与向量化，那只有 AI 服务（{@code /api/v2}，Python）能做，
 * 机制与 {@code POST /knowledge/ingest} 完全同类，所以归 AI 服务的
 * {@code POST /knowledge/documents/{id}/reindex}。详见《接口对接说明》2.3 节。
 *
 * @author JIA
 * @since 2026-09-23
 */
public interface IAdminKnowledgeService {

    /** {@code GET /knowledge/admin/conflicts} —— 条款冲突分页（高危在前）。 */
    Result<BaseQueryVo<KnowledgeConflictVo>> getConflicts(ConflictQueryDto query);

    /**
     * {@code POST /knowledge/admin/conflicts/{id}/resolve} —— 处置一条冲突。
     *
     * <p>幂等：同一条冲突用**同一个动作**重复提交，返回当前状态（200）而不是报错；
     * 换一个动作提交则 409 —— 那说明有人已经先处置过了，这里不能再覆盖掉他的结论。
     */
    Result<KnowledgeConflictVo> resolveConflict(Long id, ConflictResolveDto body);

    /** {@code GET /knowledge/admin/jobs} —— 解析/索引作业分页，含阶段明细。 */
    Result<BaseQueryVo<KnowledgeJobVo>> getJobs(KnowledgeJobQueryDto query);

    /** {@code POST /knowledge/admin/documents/{id}/publish} —— 让文档进入可检索状态。 */
    Result<DocumentActionVo> publishDocument(Long id);

    /** {@code POST /knowledge/admin/documents/{id}/offline} —— 把文档移出可检索状态。 */
    Result<DocumentActionVo> offlineDocument(Long id);
}
