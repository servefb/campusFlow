package com.campusflow.service.scan;

import com.campusflow.service.service.impl.FileScanServiceImpl;

import java.io.IOException;
import java.io.InputStream;

/**
 * 对象存储取流抽象，由 {@link MinioObjectStorage} 落地实现（MinIO {@code getObject}）。
 *
 * <p>流的生命周期由调用方管理 —— 编排器里一律 try-with-resources，用完即关，
 * 不在内存里留文件副本（GB 级文件也不会把堆打爆）。
 *
 * @see FileScanServiceImpl 编排逻辑
 */
public interface ObjectStorage {

    InputStream openStream(long fileId) throws IOException;
}
