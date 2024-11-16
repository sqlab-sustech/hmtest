import logging
import os
from logging import FileHandler


class LogConfig:
    _file_handler = None

    @classmethod
    def init_log_config(cls, output_path: str) -> None:
        os.makedirs(output_path, exist_ok=True)
        cls._file_handler = logging.FileHandler(os.path.join(output_path, 'out.log'), encoding='utf-8')
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        cls._file_handler.setFormatter(formatter)

    @classmethod
    def get_file_handler(cls) -> FileHandler:
        if cls._file_handler is None:
            raise AttributeError('File handler not initialized')
        else:
            return cls._file_handler
