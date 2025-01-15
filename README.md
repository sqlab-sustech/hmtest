# hmtest

**hmtest** is an open-source, general-purpose, and intelligent automated testing framework for HarmonyOS Next apps.

<img src="https://github.com/user-attachments/assets/01d368d6-bed4-477b-a2cb-2ca82ac6255f" alt="image" style="zoom: 50%;" />


## Setup

To run this project, ensure the following environment requirements are met:

### Hardware
- **Operating System**: Windows or macOS

### Software
- **Python**: Version 3.10 or higher
- **Node.js**: Version 16 or higher
- **DevEco Studio**: Version 5.0.0 or higher


## Usage

Add **hdc** and **hvigorw** to your system's environment path and set the **DEVECO_SDK_HOME** environment variable to the HarmonyOS SDK directory.

For example:
- Path to **hdc**: `D:\DevEco Studio\sdk\default\openharmony\toolchains`
- Path to **hvigorw**: `D:\DevEco Studio\tools\hvigor\bin`
- Path to HarmonyOS SDK: `D:\DevEco Studio\sdk`

Clone the project.

```powershell
git clone https://github.com/sqlab-sustech/hmtest.git
```

Install the dependencies in `requirements.txt`.

```powershell
pip install -r requirements.txt
```

Open the Huawei device **(HarmonyOS Next)** and get the serial number of the specific device.

```powershell
hdc list targets
```

To run RL-based Exploration, run the command:

```powershell
python main.py --serial {serial} --project_path {project_path} --bundle_name {bundle_name} --module_name {module_name} --product_name {product_name} --test_time {test_time} --seed {seed}
```

For open-source apps, you need to specify the `project_path`, `bundle_name` and `product_name`.

To run Targeted Exploration, you need to enter the `arkanalyzer` folder and install the dependencies.

```powershell
cd arkanalyzer
npm install
```

After installing the dependencies, run the Targeted Exploration using the same command as RL-based Exploration.

Once the testing is completed, the results will be saved in the `output` folder.


## Reference

- https://github.com/codematrixer/hmdriver2
- https://gitee.com/openharmony-sig/arkanalyzer

## Related Work

- https://github.com/sqlab-sustech/HarmonyOS-App-Test

## Demo
- https://youtu.be/HE6ku3Elc2U
