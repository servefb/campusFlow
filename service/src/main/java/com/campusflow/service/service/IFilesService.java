package com.campusflow.service.service;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.PostFileDto;
import com.campusflow.service.entity.po.Files;
import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.service.entity.vo.FileMetaVo;
import com.campusflow.service.entity.vo.PostFileVo;
import org.springframework.web.multipart.MultipartFile;

import java.security.NoSuchAlgorithmException;

/**
 * <p>
 *  服务类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface IFilesService extends IService<Files> {

   Result<PostFileVo> presign(PostFileDto postFileDto, MultipartFile file) throws NoSuchAlgorithmException;

   Result text(MultipartFile file);

   /**
    * 文件元数据与扫描状态（契约文档 §9 的 {@code GET /files/{file_id}}）。
    *
    * <p>管理端上传校规资料后靠它轮询到 {@code ready} 才允许建档；
    * 缺了它，轮询会落到静态资源兜底上，前端只能收到一句英文的
    * {@code No static resource files/xxx}（根因见
    * {@link com.campusflow.service.controller.FilesController#getFile(Long)}）。
    *
    * @param fileId {@code files.id}
    * @throws com.campusflow.common.exception.NotFoundException 文件不存在、已逻辑删除，或不属于当前用户
    */
   Result<FileMetaVo> getFile(Long fileId);
}
