// Import required modules
import {parse} from "https://deno.land/std@0.177.0/encoding/yaml.ts";
import {delay} from "https://deno.land/std@0.177.0/async/delay.ts";
import {existsSync} from "https://deno.land/std@0.177.0/fs/exists.ts";
import {red, green, cyan, yellow, gray} from "https://deno.land/std@0.177.0/fmt/colors.ts";

// 配置文件类型
interface Config {
  repoPath: string; // 本地仓库路径
  remoteRepo: string; // 远程仓库地址
  interval: number; // 检查间隔时间（单位：毫秒）
  branch: string; // 拉取的分支
}

// 读取配置文件
async function loadConfig(): Promise<Config> {
  try {
    const configFile = await Deno.readTextFile("./config.yaml");
    if (!configFile) {
      throw new Error(red(`[ERROR] [${new Date().toLocaleString()}] 配置文件不存在`));
    }
    const config = parse(configFile) as Config;
    if (!config.repoPath || !config.remoteRepo || !config.interval || !config.branch) {
      throw new Error(red(`[ERROR] [${new Date().toLocaleString()}] 配置文件缺少必要字段`));
    }
    return config;
  } catch (err) {
    console.error(red(`[ERROR] [${new Date().toLocaleString()}] 加载配置文件失败: ${err}`));
    Deno.exit(1);
  }
}

// 执行 shell 命令的工具函数
async function runCommand(command: string, args: string[], cwd?: string) {
  // @ts-ignore `Deno.run()` is soft-removed as of Deno 2.
  const process = Deno.run({
    cmd: [command, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const {code} = await process.status();
  const rawOutput = await process.output();
  const rawError = await process.stderrOutput();
  process.close();

  if (code === 0) {
    return new TextDecoder().decode(rawOutput).trim();
  } else {
    throw new Error(new TextDecoder().decode(rawError).trim());
  }
}

// 检查本地仓库是否为空
function isRepoEmpty(repoPath: string): boolean {
  try {
    const files = [...Deno.readDirSync(repoPath)];
    return files.length === 0;
  } catch (err) {
    // 如果目录不存在，视为“空”
    return true;
  }
}

// 克隆远程仓库
async function cloneRepo(repoPath: string, remoteRepo: string, branch: string) {
  console.log(yellow(`[INFO] [${new Date().toLocaleString()}] 本地仓库为空，正在克隆远程仓库...`));
  await runCommand("git", ["clone", "--branch", branch, remoteRepo, repoPath]);
  console.log(green(`[INFO] [${new Date().toLocaleString()}] 克隆完成。`));
}

// 检查代码是否发生变化
async function checkForChanges(repoPath: string, remoteRepo: string, branch: string) {
  console.log(gray(`[INFO] [${new Date().toLocaleString()}] 获取最新代码...`));

  // 检查仓库路径是否存在
  if (!existsSync(repoPath)) {
      console.log(red(`[ERROR] [${new Date().toLocaleString()}] 仓库路径不存在`));
      await cloneRepo(repoPath, remoteRepo, branch);
      await deploy(repoPath);
      return ;
  }

  // 拉取最新代码
  await runCommand("git", ["fetch", "origin", branch], repoPath);

  // 检查是否有代码更新
  const diff = await runCommand("git", ["diff", "HEAD", `origin/${branch}`], repoPath);
  if (diff) {
    console.log(cyan(`[INFO] [${new Date().toLocaleString()}] 检测到仓库代码发生变化。`));
    return true;
  }

  console.log(gray(`[INFO] [${new Date().toLocaleString()}] 仓库代码无变化。`));
  return false;
}

// 更新代码并执行部署命令
async function deploy(repoPath: string) {
  try {
    console.log(gray(`[INFO] [${new Date().toLocaleString()}] 拉取最新代码...`));
    await runCommand("git", ["pull"], repoPath);

    // 检查是否存在 package.json 文件
    const packageJsonPath = `${repoPath}/package.json`;
    if (existsSync(packageJsonPath)) {
      console.log(green(`[INFO] [${new Date().toLocaleString()}] 发现 package.json，正在安装依赖...`));
      await runCommand("npm", ["install"], repoPath);

      console.log(cyan(`[INFO] [${new Date().toLocaleString()}] 构建项目中...`));
      await runCommand("npm", ["run", "build"], repoPath);
      console.log(green(`[INFO] [${new Date().toLocaleString()}] 构建完成。`));
    } else {
      console.log(yellow(`[WARN] [${new Date().toLocaleString()}] 未找到 package.json，跳过 安装依赖和构建。`));
    }

    console.log(green(`[SUCCESS] [${new Date().toLocaleString()}] 部署完成！`));
  } catch (err) {
    console.error(red(`[ERROR] [${new Date().toLocaleString()}] 部署失败: ${err}`));
  }
}

// 主逻辑
async function main() {
  const config = await loadConfig();

  console.log(cyan(`[INFO] [${new Date().toLocaleString()}] 配置加载成功:`));
  console.log(cyan(`     - 本地仓库路径: ${config.repoPath}`));
  console.log(cyan(`     - 远程仓库地址: ${config.remoteRepo}`));
  console.log(cyan(`     - 检查间隔时间: ${config.interval} 毫秒`));
  console.log(cyan(`     - 分支        : ${config.branch}`));

  // 检查本地仓库是否为空
  if (isRepoEmpty(config.repoPath)) {
    await cloneRepo(config.repoPath, config.remoteRepo, config.branch);
    await deploy(config.repoPath);
  }

  while (true) {
    try {
      const hasChanges = await checkForChanges(config.repoPath, config.remoteRepo, config.branch);
      if (hasChanges) {
        await deploy(config.repoPath);
      }
    } catch (err) {
      console.error(red(`[ERROR] [${new Date().toLocaleString()}] ${err}`));
    }

    console.log(gray(`[INFO] [${new Date().toLocaleString()}] 等待下一次检查...`));
    await delay(config.interval); // 定时等待
  }
}

// 启动程序
if (import.meta.main) {
  await main();
}
