import json
import logging
import os
import random
import shutil
import time

from bs4 import BeautifulSoup

from agent.impl.q_learning_agent import QLearningAgent
from agent.impl.random_agent import RandomAgent
from app_test import AppTest
from config import LogConfig
from config.custom_json_encoder import CustomJSONEncoder
from data_collector import DataCollector


# random.seed(1)

# logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
# logger = logging.getLogger(__name__)
# logger.addHandler(LogConfig.get_file_handler())

def install_hap(app, project_path, module_name, product_name):
    signed_hap = f"{project_path}/entry/build/default/outputs/default/entry-default-signed.hap"
    # signed_hap = f"{project_path}/products/{module_name}/build/{product_name}/outputs/{product_name}/{module_name}-{product_name}-signed.hap"
    instrument_cmd = f"hvigorw --mode module -p module={module_name}@{product_name} -p product={product_name} -p buildMode=test -p ohos-test-coverage=true -p coverage-mode=black assembleHap --parallel --incremental --daemon"
    print(instrument_cmd)
    os.system(
        f"cd {project_path} && rm -rf cache report entry/.test entry/build && {instrument_cmd} && hdc uninstall {app} && hdc install {signed_hap} && rm -rf cache report")
    # os.system(
    #     f"cd {project_path} && rm -rf cache report products/phone/.test products/phone/build && {instrument_cmd} && hdc uninstall {app} && hdc install {signed_hap} && rm -rf cache report")


def get_ptg(project_path):
    if os.path.exists("./PTG.json"):
        os.remove("./PTG.json")
    project_name = project_path.split("/")[-1]
    configurations = {
        "targetProjectName": f"{project_name}",
        "targetProjectDirectory": f"{project_path}",
        "logPath": "arkanalyzer/ArkAnalyzer.log",
        "logLevel": "INFO",
        "sdks": [],
        "options": {
            "enableLeadingComments": True  # 默认是大写，这里会强制转换
        }
    }
    with open("arkanalyzer/tests/AppTestConfig.json", "w") as f:
        json.dump(configurations, f, indent=4, cls=CustomJSONEncoder)
    os.system("cd arkanalyzer && node -r ts-node/register tests/AppTest.ts")
    shutil.move("arkanalyzer/PTG.json", "./PTG.json")
    # os.system("mv arkanalyzer/PTG.json" "./PTG.json")


def get_coverage(t, self: DataCollector):
    module_name = "entry"
    # module_name = "phone"
    data_cmd = f"hdc file recv data/app/el2/100/base/{self.app_test.app}/haps/{module_name}/cache {self.project_path}"
    report_cmd = f"hvigorw collectCoverage -p projectPath={self.project_path} -p reportPath={self.project_path}/report -p coverageFile={self.project_path}/{module_name}/.test/default/intermediates/ohosTest/init_coverage.json#{self.project_path}/cache"
    # report_cmd = f"hvigorw collectCoverage -p projectPath={self.project_path} -p reportPath={self.project_path}/report -p coverageFile={self.project_path}/products/{module_name}/.test/default/intermediates/ohosTest/init_coverage.json#{self.project_path}/cache"
    os.system(f"cd {self.project_path} && rm -rf cache report && {data_cmd} && {report_cmd}")
    try:
        with open(f"{self.project_path}/report/index.html") as f:
            html = f.read()
        soup = BeautifulSoup(html, 'html.parser')
        # 找到包含四个区块的div
        coverage_divs = soup.select('.clearfix > .fl.pad1y.space-right2')
        # coverage_divs是一个列表，每个元素对应一种覆盖率
        # 顺序一般为：Statements, Branches, Functions, Lines
        results = []
        output_json = []
        for div in coverage_divs:
            percentage = div.find('span', class_='strong').text.strip()
            metric_name = div.find('span', class_='quiet').text.strip()
            fraction = div.find('span', class_='fraction').text.strip()
            # results[metric_name] = {
            #     'percentage': percentage,
            #     'fraction': fraction
            # }
            results.append((percentage, fraction))
        # obj = {
        #     "time": self.count * self.record_interval,
        #     "statement": results[0],
        #     "branch": results[1],
        #     "function": results[2],
        #     "line": results[3]
        # }
        # line = f"{self.count * self.record_interval},{results[0][0]};{results[0][1]},{results[1][0]};{results[1][1]},{results[2][0]};{results[2][1]},{results[3][0]};{results[3][1]}\n"
        line = f"{t},{results[0][0]};{results[0][1]},{results[1][0]};{results[1][1]},{results[2][0]};{results[2][1]},{results[3][0]};{results[3][1]}\n"
    except Exception as e:
        # line = f"{self.count * self.record_interval},0%;0/1,0%;0/1,0%;0/1,0%;0/1\n"
        line = f"{t},0%;0/1,0%;0/1,0%;0/1,0%;0/1\n"
    print("Coverage: ", line)
    with open(os.path.join(self.output_path, "coverage.csv"), "a") as f:
        f.write(line)


projects = [
    ("cn.icheny.wechat", "/Users/chenyige/Desktop/project/OpenHarmonyProjects/Wechat_HarmonyOS"),
    ("zone.yby.seamusic", "/Users/chenyige/Desktop/project/OpenHarmonyProjects/harmony-next-music-sharing"),
    ("com.example.harmonyhelloworld", "/Users/chenyige/Desktop/project/OpenHarmonyProjects/harmonyProject"),
    ("com.legado.app", "/Users/chenyige/Desktop/project/OpenHarmonyProjects/legado-Harmony"),
    # ("com.itcast.pass_interview", "/Users/chenyige/Desktop/project/OpenHarmonyProjects/interview-handbook-project")
]


def main(t, app, project_path, method, use_ptg, use_dfa):
    os.system("rm -rf output")
    serial = "9CN0224718027971"
    # app = "com.legado.app"
    # app = "com.sina.weibo.stage"
    # app = "zone.yby.seamusic"
    # app = "legado-Harmony"
    # app = "cn.icheny.wechat"
    # app = "com.example.harmonyhelloworld"
    # app = "com.example.multishopping"
    # project_path = "/Users/chenyige/Desktop/project/OpenHarmonyProjects/harmony-next-music-sharing"
    # project_path = "/Users/chenyige/Desktop/project/OpenHarmonyProjects/legado-Harmony"
    # project_path = "/Users/chenyige/Desktop/project/OpenHarmonyProjects/harmonyProject"
    # project_path = "/Users/chenyige/Desktop/project/OpenHarmonyProjects/codelabs/MultiShopping"
    # project_path = "/Users/chenyige/Desktop/project/OpenHarmonyProjects/Wechat_HarmonyOS"
    # project_path = ""
    # use_ptg = True
    module_name = "entry"
    # module_name = "phone"
    product_name = "default"

    if use_ptg and project_path:
        get_ptg(project_path)
    install_hap(app, project_path, module_name, product_name)

    # if method == "random":
    #     agent_type = RandomAgent
    # elif method == "q-learning":
    #     agent_type = QLearningAgent
    # else:
    #     agent_type = QLearningAgent

    app_test = AppTest(serial, app, project_path, use_ptg, use_dfa, method)
    app_test.start()
    data_collector = DataCollector(app_test, project_path)
    data_collector.start()

    start_time = time.time()

    time.sleep(t)

    print(f"Total Time: {time.time() - start_time} seconds")

    app_test.stop()
    data_collector.stop()
    app_test.join()
    data_collector.join()
    get_coverage(t, data_collector)


if __name__ == '__main__':
    # methods = ["static-q-learning", "q-learning"]
    # methods = ["q-learning", "static-q-learning"]
    # methods = ["static-q-learning"]
    methods = ["random", "q-learning", "static-q-learning", "static-dynamic-q-learning"]
    for t in [10]:
        for seed in range(6, 11):
            for method in methods:
                for app, project_path in projects:
                    if not os.path.exists(f"/Users/chenyige/Desktop/hmtest-result/{app}/{method}/{seed}/output{t}"):
                        # seed = 1
                        print("app, t, method, seed: ", app, t, method, seed)
                        random.seed(seed)
                        # print(random.random())
                        main(t * 60, app, project_path, method, "static" in method, "dynamic" in method)
                        # shutil.move("./output", f"/Users/chenyige/Desktop/new-result/Wechat_HarmonyOS/random/{seed}/output{t}")
                        # shutil.move("./output", f"/Users/chenyige/Desktop/new-result/Wechat_HarmonyOS/q-learning/{seed}/output{t}")
                        # shutil.move("./output", f"/Users/chenyige/Desktop/new-result/zone.yby.seamusic/{method}/{seed}/output{t}")
                        shutil.move("./output",
                                    f"/Users/chenyige/Desktop/hmtest-result/{app}/{method}/{seed}/output{t}")
                        print(f"{t}, {method}, {seed}, finish!")
