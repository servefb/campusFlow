package com.campusflow.service.controller;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.vo.HealthLiveVo;
import com.campusflow.service.entity.vo.HealthReadyVo;
import com.campusflow.service.service.IHealthService;
import lombok.AllArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 健康检查 —— 存活与就绪探针（契约文档第 15 章 / §A.10）。
 *
 * <h3>路径</h3>
 * 与 {@code AdminMetricsController} 同理：前端/探针按 {@code /api/v1/health/...} 发起，
 * nginx 反代时<b>剥掉 {@code /api/v1}</b>，所以服务内部路径就是 {@code /health/live}、
 * {@code /health/ready}。不要"顺手"补 {@code /api/v1}。
 *
 * <h3>🔴 这两个接口免鉴权，且这是必须的</h3>
 * 调用方是 nginx / K8s / 运维脚本 —— 它们没有（也不该有）用户 token。
 * 放行靠 {@code tools} 模块 {@code webConfig} 把 {@code /health/**} 排除出
 * {@code JwtInterceptor}；<b>没有那行配置，这里永远返回 401</b>
 * （注意拦截器是 {@code /**} 全拦，不是只拦有 Controller 的路径）。
 *
 * <p>代价是<b>任何人都能调到</b>，所以响应体里只有 up/down，不带连接串、异常原因、
 * 桶名等内部信息 —— 失败原因在 {@code HealthServiceImpl} 里打 WARN 日志。
 * 契约 §15 把这两个接口的权限标注为「内网」，部署时必须靠网络层兜住（别暴露到公网）。
 * actuator 的 {@code /actuator/health} 出于同样理由也需要注意，见
 * {@code HealthServiceImpl} 的类注释。
 *
 * <h3>为什么 ready 未就绪时返回 503</h3>
 * 契约样例只给了 {@code 200 + code:0}，本工程也另有「业务错误走 HTTP 200 + body 里的 code」
 * 的既有约定（见 {@code docs/admin-metrics/README.md}）。这里<b>有意打破后者</b>：
 * 健康检查的消费者是机器，K8s 的 {@code httpGet} 和 nginx 的 {@code health_check}
 * 只看状态码、不解析 body。若一律返 200，它们就得退化成"写脚本解析 JSON"。
 * 两种情况下 body 都是完整的 Result 信封，给人看的诊断信息一点没少。
 *
 * @author JIA
 * @since 2026-09-22
 */
@RestController
@RequestMapping("/health")
@AllArgsConstructor
public class HealthController {

    private IHealthService healthService;

    /**
     * 存活探针 {@code GET /health/live}（契约 §A.10.1）。
     *
     * <p>不碰任何依赖，恒返 200 —— 它失败只意味着进程该被重启。
     */
    @GetMapping("/live")
    public Result<HealthLiveVo> live() {
        return healthService.live();
    }

    /**
     * 就绪探针 {@code GET /health/ready}（契约 §A.10.2）。
     *
     * <p>四项依赖全部 up → {@code 200}；任一项 down → <b>{@code 503}</b>
     * （原因见类注释）。两种情况 body 都是同一种形状。
     */
    @GetMapping("/ready")
    public ResponseEntity<Result<HealthReadyVo>> ready() {
        Result<HealthReadyVo> result = healthService.ready();
        HealthReadyVo data = result.getData();
        boolean ready = data != null && HealthReadyVo.STATUS_READY.equals(data.getStatus());
        if (ready) {
            return ResponseEntity.ok(result);
        }
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(result);
    }
}
