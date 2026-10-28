package com.campusflow.service.exception;

import com.campusflow.common.exception.BusinessException;
import com.campusflow.common.exception.NotFoundException;
import com.campusflow.common.response.Result;
import jakarta.validation.ConstraintViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 全局异常 → 统一 {@link Result} 响应。
 *
 * <h3>🔴 为什么这个类在 service 层，而不是 common（2026-09-21 挪过来的）</h3>
 * 它原本放在 {@code com.campusflow.common.exception}。本次要给「路由不存在」加 handler 时发现：
 * {@link NoResourceFoundException} 在 <b>spring-webmvc</b> 且继承 <b>jakarta.servlet.ServletException</b>，
 * 而 {@code common} 模块只引了 {@code spring-web}（没有 webmvc、没有 servlet-api）——
 * 于是往 common 加至少两个依赖才能编译。
 * <p>但 {@code @RestControllerAdvice} 本来就是 Web 层的东西，往基础模块里灌 MVC 依赖是本末倒置；
 * 而 service 已经通过 {@code spring-boot-starter-web} 全都有。所以整体挪到了这里。
 * <p>组件扫描不受影响：启动类是 {@code @SpringBootApplication(scanBasePackages = "com.campusflow")}，
 * 本就覆盖 {@code com.campusflow.service.exception}。
 *
 * <h3>🔴 为什么三个 handler 必须在同一个 advice 里</h3>
 * Spring 挑 handler 的顺序是「<b>先按 advice 顺序，再在单个 advice 内按异常类型深度取最匹配</b>」——
 * 也就是说，**另一个 advice 里只要有一个 {@code Exception.class} 的兜底，就会把那边截胡**，
 * 具体类型的 handler 反而轮不上。所以 {@code NoResourceFoundException} 的处理不能"另起一个 advice
 * 放在别处"，必须和 {@link #handleException} 待在一起，靠下面的深度匹配确定性地胜出。
 * 也因此：<b>删本类所在包里的旧 class 务必 {@code mvn clean}</b>，Maven 增量编译不会清理已删源文件
 * 的 class，残留的旧 advice 会让匹配顺序变得不可预测。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(CourseOperationException.class)
    public org.springframework.http.ResponseEntity<java.util.Map<String, Object>> handleCourseOperation(
            CourseOperationException exception) {
        java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("code", exception.getCode());
        body.put("message", exception.getMessage());
        body.put("details", java.util.List.of(java.util.Map.of("reason", exception.getReason())));
        return org.springframework.http.ResponseEntity.status(exception.getHttpStatus()).body(body);
    }

    @ExceptionHandler(BusinessException.class)
    public Result<Void> handleBusinessException(BusinessException exception) {
        return Result.failure(exception.getCode(), exception.getMessage());
    }

    @ResponseStatus(HttpStatus.BAD_REQUEST)
    @ExceptionHandler({MethodArgumentNotValidException.class, ConstraintViolationException.class})
    public Result<Void> handleValidationException(Exception exception) {
        return Result.failure(HttpStatus.BAD_REQUEST.value(), exception.getMessage());
    }

    /**
     * 业务上的「找不到」（{@link NotFoundException}）。
     *
     * <p>不显式声明的话会掉进下面的 {@code Exception} 兜底：状态码从 404 变成 500，
     * 前端的语义分支就走错了（前端普遍按 404 走「资源不存在」、按 500 走「服务异常」）。
     * Spring 按「最具体的异常类型」挑 handler，所以它一定优先于兜底，不必担心被抢。
     */
    @ResponseStatus(HttpStatus.NOT_FOUND)
    @ExceptionHandler(NotFoundException.class)
    public Result<Void> handleNotFoundBusiness(NotFoundException exception) {
        return Result.failure(HttpStatus.NOT_FOUND.value(), exception.getMessage());
    }

    /**
     * 🔴 路由不存在（Spring Framework 6.1+ 的 {@link NoResourceFoundException}）。
     *
     * <p><b>触发条件</b>：请求穿过了所有 {@code @RequestMapping} 都没匹配上，最后被 Spring Boot
     * 默认注册的静态资源 handler（{@code /**} → {@code classpath:/static/}）接走，
     * static 目录下当然没有这个文件，于是抛异常，原始 message 是英文的
     * {@code No static resource files/100022.}。
     *
     * <p><b>它几乎总是「前端在调一个后端还没实现的接口」</b>（契约里定义了、代码里漏了），
     * 而不是"静态资源丢了"。所以这里：
     * <ol>
     *   <li>状态码给 <b>404</b> —— 走兜底会给 500，把「接口不存在」伪装成「服务出错」，误导排查方向；</li>
     *   <li>返回固定中文文案，<b>不透传 {@code exception.getMessage()}</b> ——
     *       那是英文的框架内部信息，直接回给前端用户既无意义又难看
     *       （之前管理端页面上那句「No static resource files/100022.」的红字就是这么来的）。</li>
     * </ol>
     *
     * <p>📌 <b>排障口诀：请求明明到达了后端，却报 {@code No static resource xxx} ⇒ 去找缺失的 mapping。</b>
     * 首个案例见 {@code FilesController#getFile}（契约有 {@code GET /files/{file_id}}，实现里漏了）。
     */
    @ResponseStatus(HttpStatus.NOT_FOUND)
    @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class})
    public Result<Void> handleNoResource(Exception exception) {
        return Result.failure(HttpStatus.NOT_FOUND.value(), "请求的接口不存在");
    }

    /**
     * 兜底。
     *
     * <p>⚠️ 保留 {@code exception.getMessage()} 原样返回是<b>有意的</b>：这是开发/联调期定位问题
     * 最直接的线索（例如本轮就是靠它看到那句英文原文才顺藤摸到缺失的路由）。
     * 将来上生产要改成固定文案「服务器内部错误」，并让真实原因只进日志 —— 那时记得同步
     * 前端对 500 的文案兜底。
     */
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    @ExceptionHandler(Exception.class)
    public Result<Void> handleException(Exception exception) {
        return Result.failure(HttpStatus.INTERNAL_SERVER_ERROR.value(), exception.getMessage());
    }
}
