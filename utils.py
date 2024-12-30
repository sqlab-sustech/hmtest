import importlib
from typing import Any


def instantiate_class_by_module_and_class_name(module_name: str, class_name: str) -> Any:
    module = importlib.import_module(module_name)
    clazz = getattr(module, class_name)
    instance = clazz()
    return instance


def get_class_by_module_and_class_name(module_name: str, class_name: str) -> type:
    module = importlib.import_module(module_name)
    return getattr(module, class_name)


def instantiate_class_by_module_and_class_name_and_params(module_name: str, class_name: str, params) -> Any:
    module = importlib.import_module(module_name)
    clazz = getattr(module, class_name)
    instance = clazz(params)
    return instance
