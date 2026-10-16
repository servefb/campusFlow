package com.campusflow.service.entity.vo;

import lombok.Data;

/**
 * 「上线 / 下线」这类**只改状态**的动作的返回值。
 *
 * <h3>为什么要带上 {@code previous_status}</h3>
 * 这两个接口都是<b>幂等</b>的：对已经是 {@code ready} 的文档再点一次「上线」，
 * 返回的也是 {@code ready}。只回一个 {@code status} 的话，页面无法区分
 * 「这次真的改了」和「本来就是」，于是要么写一句假的「已更新」，
 * 要么在什么都没发生时也弹一个成功提示。
 *
 * <p>带上原状态，调用方就能如实措辞：状态变了说「已上线」，
 * 没变说「已是上线状态，无需重复操作」。
 *
 * <p>⚠️ 前端当前只读 {@code id} / {@code status}，{@code previous_status}
 * 是**新增可选字段**（加法，不改既有语义），登记在《接口对接说明》2.3 节。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class DocumentActionVo {

    private Long id;

    /** 动作执行后的文档状态（{@code knowledge_documents.status}）。 */
    private String status;

    /** 动作执行前的文档状态；文档不存在时不会返回本对象。 */
    private String previous_status;
}
