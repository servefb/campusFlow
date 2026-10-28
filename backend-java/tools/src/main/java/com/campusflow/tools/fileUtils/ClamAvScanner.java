package com.campusflow.tools.fileUtils;

import xyz.capybara.clamav.ClamavClient;
import xyz.capybara.clamav.ClamavException;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * ClamAV（clamd）扫描器 —— 基于 {@code xyz.capybara:clamav-client} 的封装。
 *
 * <p>协议收发交给库（INSTREAM 的分块长度前缀、NUL 终止、PING/PONG 都不用自己写了），
 * 我们只在外面补两件库不做、但生产上必须做的事。
 *
 * <h3>为什么不能直接用库（三个坑）</h3>
 * <ol>
 *   <li><b>🔴 库没有任何超时设置。</b>它的 {@code Command.send} 就是
 *       {@code SocketChannel.open(server)} + 阻塞 {@code read}，没有 connect timeout，
 *       也没有 SO_TIMEOUT。clamd 一旦卡住（大文件、正在 freshclam 更新病毒库、连接数打满），
 *       <b>调用线程会无限阻塞</b>。这个扫描跑在 MQ 消费者线程上，挂住就是整条消息队列停止消费。
 *       → 所以本类用「线程池 + {@code Future.get(timeout)}」自己加一层超时，
 *       超时后 {@code cancel(true)} 中断阻塞读（{@code SocketChannel} 是可中断通道，会被关闭）。
 *       见 {@link #DEFAULT_SCAN_TIMEOUT_MS}。</li>
 *   <li><b>异常全是 unchecked 且被统一包装过。</b>库把 {@code CommunicationException} /
 *       {@code InvalidResponseException} / {@code ScanFailureException} 统统包成
 *       {@link ClamavException}（RuntimeException）。区分「网络不通」「响应看不懂」「clamd 报错」
 *       只能看 cause 和 message —— {@link #describe(ClamavException)} 做这件事。</li>
 *   <li><b>首次调用会多发一次网络往返。</b>库内部 {@code availableCommands} 是 lazy 的，
 *       第一次 {@code sendCommand} 会先发 {@code nVERSIONCOMMANDS} 取命令列表，用来校验
 *       {@code INSTREAM} 是否受支持。老版本/不标准的 clamd 若不支持该命令，会直接抛异常，
 *       导致所有扫描失败 —— 遇到「一个文件都扫不了」时先怀疑这里。</li>
 * </ol>
 *
 * <p><b>三条纪律（比代码本身重要）：</b>
 * <ol>
 *   <li><b>认不出的结果一律 UNAVAILABLE，绝不返回 CLEAN。</b>解析失败的方向必须指向更谨慎。</li>
 *   <li><b>UNAVAILABLE 不能被上层写成 rejected。</b>扫描器挂了不等于文件有问题 ——
 *       写 rejected 会让用户在毫无问题的情况下重传，还会掩盖故障。正确做法：保持 scanning + 记原因 + 重试。</li>
 *   <li>clamd 自己的大小限制（{@code clamd.conf} 的 MaxFileSize / MaxScanSize，默认 25M / 100M）
 *       会回 <code>INSTREAM size limit exceeded. ERROR</code>，要单独识别并调配置，<b>不是病毒</b>。</li>
 * </ol>
 *
 * <p>⚠️ 跑完 {@link #scan} 之后入参流处于 EOF 状态，不能再复用（库不 reset 流，也不关闭它，
 * 流的生命周期由调用方管）。
 *
 * @see com.campusflow.service.service.IFileScanService
 * @see com.campusflow.service.config.ClamAvConfig Spring 装配处
 */
public class ClamAvScanner implements AutoCloseable {

    public enum Verdict {
        /** 扫描通过。 */
        CLEAN,
        /** 命中病毒/恶意文件。 */
        INFECTED,
        /** 扫描器不可用、超时、大小超限、响应无法识别 —— 一律归这里。 */
        UNAVAILABLE
    }

    /** ⚠️ 注意：类内部引用库的结果类型必须写全限定名 —— 短名 {@code ScanResult} 被这个嵌套 record 遮蔽了。 */
    public record ScanResult(Verdict verdict, String signature, String detail) {
    }

    /**
     * 默认扫描超时：60s。大文件扫描慢，别给太短；但也别不给 —— 库本身没有超时（见类注释第 1 条）。
     */
    public static final int DEFAULT_SCAN_TIMEOUT_MS = 60_000;

    /** 并发扫描线程数。超过这个数的请求会在队列里排队，排队时间计入超时预算。 */
    private static final int DEFAULT_POOL_SIZE = 4;

    private static final AtomicInteger THREAD_SEQ = new AtomicInteger();

    private final String host;
    private final int port;
    private final int scanTimeoutMs;
    private final ClamavClient client;
    private final ExecutorService executor;

    public ClamAvScanner(String host, int port, int scanTimeoutMs) {
        this(host, port, scanTimeoutMs, DEFAULT_POOL_SIZE);
    }

    public ClamAvScanner(String host, int port, int scanTimeoutMs, int poolSize) {
        this.host = host;
        this.port = port;
        this.scanTimeoutMs = scanTimeoutMs > 0 ? scanTimeoutMs : DEFAULT_SCAN_TIMEOUT_MS;
        this.client = new ClamavClient(host, port);

        // daemon 线程：即便某次扫描卡死，也不会阻止 JVM 退出
        ThreadFactory factory = r -> {
            Thread t = new Thread(r, "clamav-scan-" + THREAD_SEQ.incrementAndGet());
            t.setDaemon(true);
            return t;
        };
        this.executor = Executors.newFixedThreadPool(Math.max(1, poolSize), factory);
    }

    public String host() {
        return host;
    }

    public int port() {
        return port;
    }

    public int scanTimeoutMs() {
        return scanTimeoutMs;
    }

    /**
     * 流式扫描。文件流边读边发（库按 2048 字节分块），不会把内容整体读进内存。
     *
     * <p><b>不抛异常</b>：任何 IO / 超时 / 服务端问题都转成 UNAVAILABLE，让调用方决定重试策略。
     */
    public ScanResult scan(InputStream fileStream) {
        Future<ScanResult> future;
        try {
            future = executor.submit(() -> blockingScan(fileStream));
        } catch (RejectedExecutionException e) {
            return new ScanResult(Verdict.UNAVAILABLE, null, "扫描线程池已满，请稍后重试");
        }

        try {
            return future.get(scanTimeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            // 🔴 这一步是库缺的：超时后必须中断，否则那个线程会一直挂在阻塞读上
            future.cancel(true);
            return new ScanResult(Verdict.UNAVAILABLE, null,
                    "扫描超时（" + scanTimeoutMs + "ms）：clamd 未在超时内返回，连接已中断");
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();   // 恢复中断位，别吞掉
            return new ScanResult(Verdict.UNAVAILABLE, null, "扫描被中断");
        } catch (ExecutionException e) {
            // blockingScan 内部已兜底，走到这里说明是意外异常
            Throwable cause = e.getCause() == null ? e : e.getCause();
            return new ScanResult(Verdict.UNAVAILABLE, null,
                    "扫描线程异常：" + cause.getClass().getSimpleName() + ": " + cause.getMessage());
        }
    }

    /** 真正阻塞的网络调用，只在扫描线程里跑。 */
    private ScanResult blockingScan(InputStream fileStream) {
        try {
            xyz.capybara.clamav.commands.scan.result.ScanResult raw = client.scan(fileStream);

            if (raw == xyz.capybara.clamav.commands.scan.result.ScanResult.OK.INSTANCE) {
                return new ScanResult(Verdict.CLEAN, null, "stream: OK");
            }
            if (raw instanceof xyz.capybara.clamav.commands.scan.result.ScanResult.VirusFound found) {
                // key = 被感染的文件路径（INSTREAM 扫描固定是 "stream"），value = 病毒名列表
                Set<String> viruses = flattenViruses(found.getFoundViruses());
                String signature = viruses.isEmpty() ? "unknown" : String.join(", ", viruses);
                return new ScanResult(Verdict.INFECTED, signature,
                        "stream: " + signature + " FOUND");
            }
            // 库新增了结果类型而这里没跟上时，宁可不可用也不要放过
            return new ScanResult(Verdict.UNAVAILABLE, null, "unrecognized result type: " + raw.getClass().getName());
        } catch (ClamavException e) {
            return new ScanResult(Verdict.UNAVAILABLE, null, describe(e));
        } catch (RuntimeException e) {
            return new ScanResult(Verdict.UNAVAILABLE, null,
                    e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /** 健康检查。库的 {@code ping()} 同样没有超时，所以也走这层超时保护。 */
    public boolean ping() {
        Future<Boolean> future;
        try {
            future = executor.submit(() -> {
                client.ping();   // 失败会抛 ClamavException
                return Boolean.TRUE;
            });
        } catch (RejectedExecutionException e) {
            return false;
        }
        try {
            return Boolean.TRUE.equals(future.get(scanTimeoutMs, TimeUnit.MILLISECONDS));
        } catch (TimeoutException e) {
            future.cancel(true);
            return false;
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            return false;
        } catch (ExecutionException e) {
            return false;
        }
    }

    /** 只判断扫描器是否可用（拿一个空流去扫，期望 OK），用于排障时区分「服务通了但库没起来」。 */
    public boolean isReady() {
        return scan(InputStream.nullInputStream()).verdict() == Verdict.CLEAN;
    }

    @Override
    public void close() {
        executor.shutdownNow();
    }

    /**
     * 把库的异常翻成人话，并把「clamd 报错」和「网络问题」分开 —— 两者的处置方式完全不同。
     */
    private static String describe(ClamavException e) {
        Throwable cause = e.getCause();
        String message = cause != null && cause.getMessage() != null ? cause.getMessage() : String.valueOf(e.getMessage());
        String lower = message == null ? "" : message.toLowerCase();

        if (lower.contains("size limit exceeded")) {
            // clamd 的配置限制，不是病毒：调 MaxFileSize / MaxScanSize，或大文件改走路径扫描
            return "clamd size limit exceeded: " + message;
        }

        String causeName = cause == null ? "unknown" : cause.getClass().getSimpleName();
        return switch (causeName) {
            case "CommunicationException" -> "无法与 clamd 通信（连接失败/中断）: " + message;
            case "InvalidResponseException" -> "clamd 响应无法识别: " + message;
            case "ScanFailureException" -> "clamd 扫描失败: " + message;
            case "UnknownCommandException", "UnsupportedCommandException" ->
                    "clamd 不支持该命令（可能是老版本 daemon）: " + message;
            default -> "ClamAV 调用失败（" + causeName + "）: " + message;
        };
    }

    private static Set<String> flattenViruses(Map<String, Collection<String>> foundViruses) {
        Set<String> all = new LinkedHashSet<>();
        if (foundViruses == null) {
            return all;
        }
        List<Collection<String>> values = new ArrayList<>(foundViruses.values());
        for (Collection<String> viruses : values) {
            if (viruses != null) {
                all.addAll(viruses);
            }
        }
        return all;
    }
}
