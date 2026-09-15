use std::{
    fs, io,
    path::{Path, PathBuf},
};

pub const DATA_DIRECTORY_NAME: &str = "data";

fn executable_directory_from(path: &Path) -> io::Result<&Path> {
    path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "executable directory is unavailable",
        )
    })
}

pub fn root_directory() -> io::Result<PathBuf> {
    let executable = std::env::current_exe()?;
    let directory = executable_directory_from(&executable)?.join(DATA_DIRECTORY_NAME);
    fs::create_dir_all(&directory)?;
    Ok(directory)
}

pub fn directory(name: &str) -> io::Result<PathBuf> {
    let directory = root_directory()?.join(name);
    fs::create_dir_all(&directory)?;
    Ok(directory)
}

pub fn file(name: &str) -> io::Result<PathBuf> {
    Ok(root_directory()?.join(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_directory_is_beside_the_executable() {
        let executable = Path::new(r"C:\Portable\JellySmith\JellySmith.exe");
        assert_eq!(
            executable_directory_from(executable)
                .unwrap()
                .join(DATA_DIRECTORY_NAME),
            PathBuf::from(r"C:\Portable\JellySmith\data")
        );
    }

    #[test]
    fn executable_without_a_parent_is_rejected() {
        assert!(executable_directory_from(Path::new("")).is_err());
    }
}
