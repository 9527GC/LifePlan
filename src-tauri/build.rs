fn main() {
    // 将构建渠道（LIFEPLAN_ENV）烘焙进二进制，供运行时区分测试/生产数据目录。
    let build_env = std::env::var("LIFEPLAN_ENV").unwrap_or_default();
    println!("cargo:rustc-env=LIFEPLAN_BUILD_ENV={build_env}");
    println!("cargo:rerun-if-env-changed=LIFEPLAN_ENV");
    tauri_build::build()
}
