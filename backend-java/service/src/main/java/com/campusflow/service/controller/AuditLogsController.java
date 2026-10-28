package com.campusflow.service.controller;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.AutoLogDto;
import com.campusflow.service.entity.vo.AuditSummaryVo;
import com.campusflow.service.service.IAuditLogsService;
import com.campusflow.service.support.AuditExport;
import io.swagger.v3.oas.annotations.parameters.RequestBody;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;

/**
 * 审计日志（契约文档第 15 章）。
 *
 * <h3>⚠️ 这里没有 Spring 的 {@code @RequestBody}，参数是从 query 绑定的</h3>
 * 方法上的 {@code @RequestBody} 是 <b>Swagger 的注解</b>
 * （{@code io.swagger.v3.oas.annotations}），只影响接口文档展示，运行时由 Spring 的默认绑定规则处理 ——
 * 只有 Spring 自己的 {@code org.springframework.web.bind.annotation.RequestBody} 才会要求必带 body。
 * <b>不要"顺手"把它换成 Spring 那个</b>：换了之后所有查询都会变成 400（GET 没有请求体）。
 *
 * <h3>2026-09-23 新增 {@code /summary}</h3>
 * 管理端台账概览行需要四项读数（今日事件 / 高危阻断 / 自动任务占比 / 存续周期），
 * 此前没有接口，页面只能借分页 {@code total} 兜底（口径并不对：那是当前筛选窗口的总数，不是「今日」）。
 *
 * @author JIA
 * @since 2026-09-04
 */
@RestController
@RequestMapping("/admin/audit-logs")
@RequiredArgsConstructor
public class AuditLogsController {

    private final IAuditLogsService auditLogsService;

    @GetMapping
    public Result getAuditLogs(@RequestBody AutoLogDto autoLogDto) {
        return auditLogsService.getAuditLogs(autoLogDto);
    }

    /**
     * {@code GET /admin/audit-logs/summary} —— 概览四项读数（口径见 {@code AuditSummaryVo}）。
     *
     * <p>⚠️ 本类目前没有 {@code /{id}} 形式的映射，所以声明顺序无关紧要；
     * 但将来若加了模板变量路径，字面量段必须排在前面，否则 {@code /summary}
     * 会被当成 {@code id=summary} 去查。
     */
    @GetMapping("/summary")
    public Result<AuditSummaryVo> getAuditSummary() {
        return auditLogsService.getAuditSummary();
    }

    /**
     * {@code GET /admin/audit-logs/export} —— 导出 CSV。
     *
     * <h3>⚠️ 返回的不是 {@code Result} 包络</h3>
     * 这是本工程第一个**直接回文件流**的接口（其余全部回 JSON 包络）。原因是它的用途是
     * 「存成一个文件」，外面再套一层 {@code {code, message, data}} 会让浏览器拿到一份
     * 装着 base64 或转义串的 JSON，「另存为」出来根本不是 CSV。
     *
     * <h3>为什么把「导了多少行」放在响应头</h3>
     * 没有包络就没有地方放元信息。而**静默截断是不可接受的** —— 管理员会把一个不完整的
     * 文件当成全量日志去做合规归档。所以行数、上限、是否截断各占一个头，前端据此提示。
     * 见 {@link AuditExport}。
     *
     * <h3>失败时回什么</h3>
     * 鉴权失败（非管理员）与参数非法仍然是 JSON 包络 + HTTP 200 + 非 0 {@code code}
     * （本工程的一贯行为，见《接口对接说明》第六节）。前端因此必须<b>先看
     * {@code Content-Type}</b>：是 JSON 就说明这次导出没成功，别把它当成 CSV 存盘。
     *
     * <p>⚠️ 与同类里的 {@code /summary} 一样，字面量段必须排在任何 {@code /{id}} 之前
     * （本类目前没有模板变量映射，但将来加了就会踩）。
     */
    @GetMapping("/export")
    public ResponseEntity<byte[]> exportAuditLogs(AutoLogDto autoLogDto) {
        AuditExport exported = auditLogsService.exportAuditLogs(autoLogDto);

        // 文件名用 RFC 5987 编码（ContentDisposition 负责），避免中文/特殊字符在不同浏览器上乱码
        String fileName = "audit-logs-" + LocalDate.now() + ".csv";
        ContentDisposition disposition = ContentDisposition.attachment()
                .filename(fileName, StandardCharsets.UTF_8)
                .build();

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header("X-Export-Rows", String.valueOf(exported.rows()))
                .header("X-Export-Limit", String.valueOf(exported.limit()))
                .header("X-Export-Truncated", String.valueOf(exported.truncated()))
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(exported.content());
    }
}
