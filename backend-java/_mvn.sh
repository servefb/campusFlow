#!/bin/sh
# 本机 Maven 包装脚本。
#
# 为什么不直接用 mvn：Git Bash 里跑 `mvn` 会挂在
#   ClassNotFoundException: org.codehaus.plexus.classworlds.launcher.Launcher
# （MSYS 把 classworlds.conf 这类参数当成路径转换了）。
# 下面绕开 mvn 启动脚本，把 plexus-classworlds 的 classpath 和三个 -D 参数直接喂给 java。
#
# 用法：./_mvn.sh clean compile -pl service -am
exec "/d/New Folder/bin/java.exe" \
  -classpath "D:/apache-maven-3.9.16/boot/plexus-classworlds-2.11.0.jar" \
  "-Dclassworlds.conf=D:/apache-maven-3.9.16/bin/m2.conf" \
  "-Dmaven.home=D:/apache-maven-3.9.16" \
  "-Dmaven.multiModuleProjectDirectory=C:/Users/Lenovo/IdeaProjects/campusflow" \
  org.codehaus.plexus.classworlds.launcher.Launcher "$@"
