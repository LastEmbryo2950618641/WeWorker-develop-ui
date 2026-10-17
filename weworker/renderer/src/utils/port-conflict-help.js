export function getPortConflictHelp(port, isWindows) {
  if (isWindows) {
    return {
      command: `netstat -ano | findstr :${port}`,
      killCommand: 'taskkill /PID <PID> /F',
      title: '在 LISTENING 行查看 PID，再到任务管理器「详细信息」确认对应程序；确认后正常关闭并重启 WeWorker',
    }
  }

  return {
    command: `lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    killCommand: 'kill <PID>',
    title: '查看占用端口的程序；确认后正常退出，再重启 WeWorker',
  }
}
