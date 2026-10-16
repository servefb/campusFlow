package com.campusflow.service.entity.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * 文件扫描任务的消息体（投递到 {@code file.scan.queue}）。
 *
 * <h3>为什么只有一个 fileId</h3>
 * purpose、原始文件名、声明的 content_type 全部由消费端从 {@code files} 行里读 ——
 * <b>MySQL 是唯一事实来源</b>。消息里冗余这些字段只会带来「消息里的值和库里不一致时信谁」的问题，
 * 而且扫描本来就要读库（写状态回 {@code files}），不多这一次查询。
 *
 * <h3>⚠️ 千万别把 MultipartFile 塞进消息</h3>
 * 两重原因：① {@code MultipartFile} 是 servlet 请求对象，没法序列化（原来的写法就是这样，等于没通）；
 * ② 投递时文件<b>已经落进 MinIO 了</b>，消费端要的是「按 object_key 去对象存储取流」，
 * 而不是把字节再复制一份塞进消息队列 —— 那样大文件会把 broker 内存打爆。
 *
 * @see com.campusflow.service.listener.FileListener 消费端
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class FileScanMessage implements Serializable {

    private static final long serialVersionUID = 1L;

    /** {@code files.id}。 */
    private Long fileId;
}
