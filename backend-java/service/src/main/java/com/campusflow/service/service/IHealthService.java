package com.campusflow.service.service;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.vo.HealthLiveVo;
import com.campusflow.service.entity.vo.HealthReadyVo;

/**
 * 健康检查服务（契约文档第 15 章，归业务服务 {@code /health/*}）。
 *
 * <p>只被 {@code HealthController} 调用。<b>与其它 Service 不同，这里没有任何鉴权</b> ——
 * 这两个接口的调用方是 nginx / K8s / 运维脚本，它们没有（也不该有）用户 token。
 * 免鉴权通过 {@code tools} 模块的 {@code webConfig} 把 {@code /health/**} 排除出
 * {@code JwtInterceptor} 实现，所以本层的任何实现都<b>会被匿名调用</b>，
 * 返回体里绝不能带任何内部信息（连接串、版本号、异常堆栈、桶名……）。
 * 这也是为什么 {@code checks} 只给 up/down 而没有失败原因。
 *
 * @author JIA
 * @since 2026-09-22
 */
public interface IHealthService {

    /**
     * 进程存活探针 {@code GET /health/live}（契约 §A.10.1）。
     *
     * <p>不碰任何外部依赖 —— 失败只可能意味着进程该被重启。
     *
     * @return 恒为一个成功的 {@code status=up} 响应
     */
    Result<HealthLiveVo> live();

    /**
     * 就绪探针 {@code GET /health/ready}（契约 §A.10.2）。
     *
     * <p>并行探测 mysql / object_storage / agent_gateway / fulltext_index 四项，
     * 全部 up 时 {@code status=ready}，否则 {@code status=not_ready}。
     * <b>本方法不抛异常</b>：任何单项失败都降级成 {@code down} 并照常返回 ——
     * 健康检查自己返回 5xx 是最糟的失败模式（运维分不清是服务挂了还是探针挂了）。
     *
     * @return 四项依赖的探测结果；未就绪时由 Controller 转成 HTTP 503
     */
    Result<HealthReadyVo> ready();
}
