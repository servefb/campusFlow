package com.campusflow.service.scan;

import com.campusflow.service.config.MinioConfig;
import com.campusflow.service.entity.po.Files;
import com.campusflow.service.mapper.FilesMapper;
import io.minio.GetObjectArgs;
import io.minio.MinioClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;

/**
 * {@link ObjectStorage} 的落地实现：按 fileId 从 MinIO 取原始流。
 *
 * <p>扫描编排一份文件会取三次流（一次 MIME 嗅探、一次病毒扫描、一次抽正文），
 * 这是有意为之 —— 每次用完即关，不在内存里留副本。代价是三次对象存储 GET，
 * 换来的是「GB 级文件也不会把堆打爆」。若将来发现小文件场景下这个开销明显，
 * 可以在这里加一层「小于阈值就缓存到临时文件」的优化，而不是把整块读进内存。
 *
 * <p>⚠️ 返回的流是 {@code GetObjectResponse}（HTTP 响应流），<b>必须由调用方 close</b>，
 * 否则会泄露连接。{@link com.campusflow.service.service.impl.FileScanServiceImpl} 里一律 try-with-resources。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MinioObjectStorage implements ObjectStorage {

    private final MinioClient minioClient;
    private final MinioConfig minioConfig;
    private final FilesMapper filesMapper;

    @Override
    public InputStream openStream(long fileId) throws IOException {
        Files f = filesMapper.selectById(fileId);
        if (f == null) {
            throw new IOException("files 记录不存在：fileId=" + fileId);
        }
        String objectKey = f.getObjectKey();
        if (objectKey == null || objectKey.isBlank()) {
            throw new IOException("object_key 为空，字节可能没上传成功：fileId=" + fileId);
        }
        try {
            return minioClient.getObject(GetObjectArgs.builder()
                    .bucket(minioConfig.getBucketName())
                    .object(objectKey)
                    .build());
        } catch (Exception e) {
            // 统一转成 IOException：编排层据此判「存储不可用 → 保持 scanning」（不是文件有问题）
            throw new IOException("从 MinIO 取流失败：objectKey=" + objectKey
                    + "，原因=" + e.getClass().getSimpleName() + ": " + e.getMessage(), e);
        }
    }
}
