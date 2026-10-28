package com.campusflow.service.service.impl;


import com.campusflow.common.exception.NotFoundException;
import com.campusflow.common.exception.StorageException;
import com.campusflow.service.config.MinioConfig;
import io.minio.*;
import io.minio.errors.ErrorResponseException;
import io.minio.http.Method;
import jakarta.annotation.PostConstruct;
import lombok.AllArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.time.Duration;
import java.util.concurrent.TimeUnit;

@Service
@AllArgsConstructor
public class MinioService {

    private MinioClient minioClient;
    private MinioConfig minioConfig;

    @PostConstruct
    public void initBucket() throws Exception {
        String bucket = minioConfig.getBucketName();
        if (!minioClient.bucketExists(BucketExistsArgs.builder().bucket(bucket).build())) {
            minioClient.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
        }
    }

    public String uploadFile(MultipartFile file, String objectName) throws Exception {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("file is empty");
        }
        if (objectName == null || objectName.isBlank()
                || objectName.startsWith("/") || objectName.contains("..")) {
            throw new IllegalArgumentException("invalid objectName");
        }

        String bucket = minioConfig.getBucketName();
        String contentType = file.getContentType();
        if (contentType == null || contentType.isBlank()) {
            contentType = "application/octet-stream";
        }

        try (InputStream in = file.getInputStream()) {
            minioClient.putObject(
                    PutObjectArgs.builder()
                            .bucket(bucket)
                            .object(objectName)
                            .stream(in, file.getSize(), -1)
                            .contentType(contentType)
                            .build()
            );
            return objectName;
        } catch (Exception e) {
            throw new Exception("upload failed: " + objectName, e);
        }
    }

    public String getPresignedGetUrl(String objectKey, Duration expiry) throws Exception {
        try {
            return minioClient.getPresignedObjectUrl(
                    GetPresignedObjectUrlArgs.builder()
                            .method(Method.GET)
                            .bucket(minioConfig.getBucketName())
                            .object(objectKey)
                            .expiry((int) expiry.getSeconds(), TimeUnit.SECONDS)
                            .build()
            );
        } catch (Exception e) {
            throw new Exception("presign failed: " + objectKey, e);
        }
    }

    /**
     * 直接写字节：给「服务端自己生成的文件」用（当前的唯一场景是用户名单 CSV 导出）。
     *
     * <p>为什么不复用 {@link #uploadFile(MultipartFile, String)}：那个入口要一个
     * {@code MultipartFile}，而导出文件是后端拼出来的字节，构造 {@code MockMultipartFile}
     * 需要把 spring-test 拉进运行时依赖 —— 为了一个「上传」把测试库带进生产包不值得。
     *
     * <p>校验与 {@code uploadFile} 保持一致（不空、不绝对路径、不含 {@code ..}），
     * 避免出现「某个入口能写出去、另一个不能」的绕过面。
     */
    public String uploadBytes(byte[] content, String contentType, String objectName) {
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("content is empty");
        }
        validateObjectName(objectName);
        String type = (contentType == null || contentType.isBlank()) ? "application/octet-stream" : contentType;
        try (InputStream in = new java.io.ByteArrayInputStream(content)) {
            minioClient.putObject(
                    PutObjectArgs.builder()
                            .bucket(minioConfig.getBucketName())
                            .object(objectName)
                            .stream(in, content.length, -1)
                            .contentType(type)
                            .build()
            );
            return objectName;
        } catch (Exception e) {
            throw new StorageException("upload failed: " + objectName, e.getMessage());
        }
    }


    /**
     * 小文件下载：读成 byte[]，流在方法内关闭
     */
    public byte[] downloadBytes(String objectName) {
        validateObjectName(objectName);
        try (InputStream in = minioClient.getObject(
                GetObjectArgs.builder()
                        .bucket(minioConfig.getBucketName())
                        .object(objectName)
                        .build())) {
            return in.readAllBytes();
        } catch (ErrorResponseException e) {
            if ("NoSuchKey".equals(e.errorResponse().code())) {
                throw new NotFoundException("file not found: " + objectName);
            }
            throw new StorageException("download failed: " + objectName, e.errorResponse().message());
        } catch (Exception e) {
            throw new StorageException("download failed: " + objectName, e.getMessage());
        }
    }


    /**
     * 删除对象：幂等，不抛 NotFound
     */
    public void deleteObject(String objectName) {
        validateObjectName(objectName);
        try {
            minioClient.removeObject(
                    RemoveObjectArgs.builder()
                            .bucket(minioConfig.getBucketName())
                            .object(objectName)
                            .build()
            );
        } catch (Exception e) {
            throw new StorageException("delete failed: " + objectName, e.getMessage());
        }
    }

    private void validateObjectName(String objectName) {
        if (objectName == null || objectName.isBlank()
                || objectName.startsWith("/")
                || objectName.contains("..")) {
            throw new IllegalArgumentException("invalid objectName: " + objectName);
        }
    }

}
