import re
from typing import List, Tuple, Dict, Any

from action.window_action import WindowAction
from state.window_state import WindowState


class TagTable:
    TAG_MAP = {
        "a": 2,
        "/a": 3,
        "abbr": 4,
        "/abbr": 5,
        "acronym": 6,
        "/acronym": 7,
        "address": 8,
        "/address": 9,
        "applet": 10,
        "/applet": 11,
        "area": 12,
        "/area": 13,
        "article": 14,
        "/article": 15,
        "aside": 16,
        "/aside": 17,
        "audio": 18,
        "/audio": 19,
        "b": 20,
        "/b": 21,
        "base": 22,
        "/base": 23,
        "basefont": 24,
        "/basefont": 25,
        "bdi": 26,
        "/bdi": 27,
        "bdo": 28,
        "/bdo": 29,
        "big": 30,
        "/big": 31,
        "blockquote": 32,
        "/blockquote": 33,
        "body": 34,
        "/body": 35,
        "br": 36,
        "/br": 37,
        "button": 38,
        "/button": 39,
        "canvas": 40,
        "/canvas": 41,
        "caption": 42,
        "/caption": 43,
        "center": 44,
        "/center": 45,
        "cite": 46,
        "/cite": 47,
        "code": 48,
        "/code": 49,
        "col": 50,
        "/col": 51,
        "colgroup": 52,
        "/colgroup": 53,
        "data": 54,
        "/data": 55,
        "datalist": 56,
        "/datalist": 57,
        "dd": 58,
        "/dd": 59,
        "del": 60,
        "/del": 61,
        "details": 62,
        "/details": 63,
        "dfn": 64,
        "/dfn": 65,
        "dialog": 66,
        "/dialog": 67,
        "dir": 68,
        "/dir": 69,
        "div": 70,
        "/div": 71,
        "dl": 72,
        "/dl": 73,
        "dt": 74,
        "/dt": 75,
        "em": 76,
        "/em": 77,
        "embed": 78,
        "/embed": 79,
        "fieldset": 80,
        "/fieldset": 81,
        "figcaption": 82,
        "/figcaption": 83,
        "figure": 84,
        "/figure": 85,
        "font": 86,
        "/font": 87,
        "footer": 88,
        "/footer": 89,
        "form": 90,
        "/form": 91,
        "frame": 92,
        "/frame": 93,
        "frameset": 94,
        "/frameset": 95,
        "h1": 96,
        "/h1": 97,
        "h2": 98,
        "/h2": 99,
        "h3": 100,
        "/h3": 101,
        "h4": 102,
        "/h4": 103,
        "h5": 104,
        "/h5": 105,
        "h6": 106,
        "/h6": 107,
        "head": 108,
        "/head": 109,
        "header": 110,
        "/header": 111,
        "hr": 112,
        "/hr": 113,
        "html": 114,
        "/html": 115,
        "i": 116,
        "/i": 117,
        "iframe": 118,
        "/iframe": 119,
        "img": 120,
        "/img": 121,
        "input": 122,
        "/input": 123,
        "ins": 124,
        "/ins": 125,
        "kbd": 126,
        "/kbd": 127,
        "label": 128,
        "/label": 129,
        "legend": 130,
        "/legend": 131,
        "li": 132,
        "/li": 133,
        "link": 134,
        "/link": 135,
        "main": 136,
        "/main": 137,
        "map": 138,
        "/map": 139,
        "mark": 140,
        "/mark": 141,
        "meta": 142,
        "/meta": 143,
        "meter": 144,
        "/meter": 145,
        "nav": 146,
        "/nav": 147,
        "noframes": 148,
        "/noframes": 149,
        "noscript": 150,
        "/noscript": 151,
        "object": 152,
        "/object": 153,
        "ol": 154,
        "/ol": 155,
        "optgroup": 156,
        "/optgroup": 157,
        "option": 158,
        "/option": 159,
        "output": 160,
        "/output": 161,
        "p": 162,
        "/p": 163,
        "param": 164,
        "/param": 165,
        "picture": 166,
        "/picture": 167,
        "pre": 168,
        "/pre": 169,
        "progress": 170,
        "/progress": 171,
        "q": 172,
        "/q": 173,
        "rp": 174,
        "/rp": 175,
        "rt": 176,
        "/rt": 177,
        "ruby": 178,
        "/ruby": 179,
        "s": 180,
        "/s": 181,
        "samp": 182,
        "/samp": 183,
        "script": 184,
        "/script": 185,
        "section": 186,
        "/section": 187,
        "select": 188,
        "/select": 189,
        "small": 190,
        "/small": 191,
        "source": 192,
        "/source": 193,
        "span": 194,
        "/span": 195,
        "strike": 196,
        "/strike": 197,
        "strong": 198,
        "/strong": 199,
        "style": 200,
        "/style": 201,
        "sub": 202,
        "/sub": 203,
        "summary": 204,
        "/summary": 205,
        "sup": 206,
        "/sup": 207,
        "svg": 208,
        "/svg": 209,
        "table": 210,
        "/table": 211,
        "tbody": 212,
        "/tbody": 213,
        "td": 214,
        "/td": 215,
        "template": 216,
        "/template": 217,
        "textarea": 218,
        "/textarea": 219,
        "tfoot": 220,
        "/tfoot": 221,
        "th": 222,
        "/th": 223,
        "thead": 224,
        "/thead": 225,
        "time": 226,
        "/time": 227,
        "title": 228,
        "/title": 229,
        "tr": 230,
        "/tr": 231,
        "track": 232,
        "/track": 233,
        "tt": 234,
        "/tt": 235,
        "u": 236,
        "/u": 237,
        "ul": 238,
        "/ul": 239,
        "var": 240,
        "/var": 241,
        "video": 242,
        "/video": 243,
        "wbr": 244,
        "/wbr": 245
    }

    @staticmethod
    def to_char(tag):
        return chr(TagTable.TAG_MAP.get(tag, 0))


class TagSequenceState(WindowState):

    def get_action_list(self) -> List[WindowAction]:
        pass

    def get_action_detailed_data(self) -> Tuple[Dict[WindowAction, Any], Any]:
        pass

    def update_action_execution_time(self, action: WindowAction) -> None:
        pass

    def update_transition_information(self, action: WindowAction, new_state: 'WindowState') -> None:
        pass

    def __lt__(self, other: object) -> bool:
        pass

    def __init__(self, html):
        self.mapped_tags = to_mapped_tags(html)

    def __eq__(self, other):
        if isinstance(other, TagSequenceState):
            return self.mapped_tags == other.mapped_tags
        return False

    def similarity(self, other):
        if not isinstance(other, TagSequenceState):
            return 0
        return tag_similarity(self.mapped_tags, other.mapped_tags)


def to_mapped_tags(html):
    result = []
    pattern = re.compile(r"<!(--)?(.*?)-->|<(/?\w+).*?(/?)>")
    matches = pattern.finditer(html)
    for match in matches:
        g2 = match.group(2)
        if g2 is None:  # g1 != None 表示匹配到了HTML注释
            g3 = match.group(3)
            g4 = match.group(4)
            tag = g4 + g3  # 生成 /a 而不是 a/
            result.append(TagTable.to_char(tag))  # 假设TagTable.to_char(tag)是转换标签的函数

    return ''.join(result)


def tag_similarity(s1: str, s2: str) -> float:
    if s1 is None:
        raise ValueError("s1 must not be null")

    if s2 is None:
        raise ValueError("s2 must not be null")

    if s1 == s2:
        return 1.0

    matches = get_match_list(s1, s2)
    sum_of_matches = sum(len(match) for match in matches)

    return 2.0 * sum_of_matches / (len(s1) + len(s2))


def get_match_list(s1: str, s2: str) -> List[str]:
    list_matches = []
    match = front_max_match(s1, s2)

    if match:
        front_source = s1[:s1.index(match)]
        front_target = s2[:s2.index(match)]
        front_queue = get_match_list(front_source, front_target)

        end_source = s1[s1.index(match) + len(match):]
        end_target = s2[s2.index(match) + len(match):]
        end_queue = get_match_list(end_source, end_target)

        list_matches.append(match)
        list_matches.extend(front_queue)
        list_matches.extend(end_queue)

    return list_matches


def front_max_match(s1: str, s2: str) -> str:
    longest = 0
    longest_substring = ""
    for i in range(len(s1)):
        for j in range(i + 1, len(s1) + 1):
            substring = s1[i:j]
            if substring in s2 and len(substring) > longest:
                longest = len(substring)
                longest_substring = substring

    return longest_substring
