package com.campusflow.service.controller;


import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.PostFileDto;
import com.campusflow.service.entity.vo.FileMetaVo;
import com.campusflow.service.service.IFilesService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.*;

import org.springframework.web.multipart.MultipartFile;

import java.security.NoSuchAlgorithmException;

/**
 * <p>
 *  前端控制器
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@RestController
@RequestMapping("/files")
@AllArgsConstructor
public class FilesController {

    private IFilesService filesService;

    @PostMapping("/presign")
    public Result presign(@ModelAttribute PostFileDto postFileDto,
                          @RequestParam("file") MultipartFile file) throws NoSuchAlgorithmException {
        return filesService.presign(postFileDto,file);
    }

    @PostMapping("/text")
    public Result text(@RequestParam("file") MultipartFile file){
        return filesService.text(file);
    }

    @GetMapping("/{fileId}")
    public Result<FileMetaVo> getFile(@PathVariable Long fileId) {
        return filesService.getFile(fileId);
    }
}
