# -*- coding: utf-8 -*-

from typing import Dict
from lxml import etree
from functools import cached_property

from . import logger
from .proto import Bounds
from .driver import Driver
from .utils import delay, parse_bounds
from .exception import XmlElementNotFoundError
import re


class _XPath:
    def __init__(self, d: Driver):
        self._d = d

    def __call__(self, xpath: str) -> 'XMLElement':

        hierarchy: Dict = self._d.dump_hierarchy()
        if not hierarchy:
            raise XmlElementNotFoundError(f"xpath: {xpath} not found")

        xml = _XPath._json2xml(hierarchy)
        result = xml.xpath(xpath)

        if len(result) > 0:
            node = result[0]
            raw_bounds: str = node.attrib.get("bounds")  # [832,1282][1125,1412]
            bounds: Bounds = parse_bounds(raw_bounds)
            logger.debug(f"{xpath} Bounds: {bounds}")
            types = re.findall(r'//?(\w+)\[\d+]', xpath)
            return XMLElement(bounds, types[-1], self._d)

        logger.error(f"xpath: {xpath} not found")
        return XMLElement(None, None, self._d)

    @staticmethod
    def _json2xml(hierarchy: Dict) -> etree.Element:
        attributes = hierarchy.get("attributes", {})
        tag = attributes.get("type", "orgRoot") or "orgRoot"
        xml = etree.Element(tag, attrib=attributes)

        children = hierarchy.get("children", [])
        for item in children:
            xml.append(_XPath._json2xml(item))
        return xml


class XMLElement:
    def __init__(self, bounds: Bounds | None, ele_type: str | None, d: Driver):
        self.bounds = bounds
        self.ele_type = ele_type
        self._d = d

    def _verify(self):
        if not self.bounds or not self.ele_type:
            raise XmlElementNotFoundError("xpath not found")

    @cached_property
    def center(self):
        self._verify()
        return self.bounds.get_center()

    def exists(self) -> bool:
        return self.bounds is not None

    @delay
    def click(self):
        x, y = self.center.x, self.center.y
        self._d.click(x, y)

    @delay
    def click_if_exists(self):

        if not self.exists():
            logger.debug("click_exist: xpath not found")
            return

        x, y = self.center.x, self.center.y
        self._d.click(x, y)

    @delay
    def double_click(self):
        x, y = self.center.x, self.center.y
        self._d.double_click(x, y)

    @delay
    def long_click(self):
        x, y = self.center.x, self.center.y
        self._d.long_click(x, y)

    @delay
    def input_text(self, text):
        self.click()
        self._d.input_text(text)
