/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import path from 'path';
import { Scene } from '../Scene';
import { ArkClass } from '../core/model/ArkClass';
import { ArkMethod } from '../core/model/ArkMethod';
import { Stmt } from '../core/base/Stmt';
import { FunctionType } from '../core/base/Type';

export const LIFECYCLE_METHOD_NAME: string[] = [
    'onCreate', // 组件实例创建
    'onDestroy', // 组件实例销毁
    'onWindowStageCreate', // 窗口创建
    'onWindowStageDestroy', // 窗口销毁
    'onForeground', // 应用进入前台
    'onBackground', // 应用进入后台
    'onBackup', // 应用数据备份
    'onRestore', // 应用数据恢复
    'onContinue',
    'onNewWant',
    'onDump',
    'onSaveState',
    'onShare',
    'onPrepareToTerminate',
    'onBackPressed',
    'onSessionCreate',
    'onSessionDestory',
    'onAddForm',
    'onCastToNormalForm',
    'onUpdateForm',
    'onChangeFormVisibility',
    'onFormEvent',
    'onRemoveForm',
    'onConfigurationUpdate',
    'onAcquireFormState',
    'onWindowStageWillDestroy',
  ];
export const CALLBACK_METHOD_NAME: string[] = [
    "onClick", // 点击事件，当用户点击组件时触发
    "onTouch", // 触摸事件，当手指在组件上按下、滑动、抬起时触发
    "onAppear", // 组件挂载显示时触发
    "onDisAppear", // 组件卸载消失时触发
    "onDragStart", // 拖拽开始事件，当组件被长按后开始拖拽时触发
    "onDragEnter", // 拖拽进入组件范围时触发
    "onDragMove", // 拖拽在组件范围内移动时触发
    "onDragLeave", // 拖拽离开组件范围内时触发
    "onDrop", // 拖拽释放目标，当在本组件范围内停止拖拽行为时触发
    "onKeyEvent", // 按键事件，当组件获焦后，按键动作触发
    "onFocus", // 焦点事件，当组件获取焦点时触发
    "onBlur", // 当组件失去焦点时触发的回调
    "onHover", // 鼠标悬浮事件，鼠标进入或退出组件时触发
    "onMouse", // 鼠标事件，当鼠标按键点击或在组件上移动时触发
    "onAreaChange", // 组件区域变化事件，组件尺寸、位置变化时触发
    "onVisibleAreaChange", // 组件可见区域变化事件，组件在屏幕中的显示区域面积变化时触发
  ];

export const COMPONENT_LIFECYCLE_METHOD_NAME: string[] = [
    'build',
    'aboutToAppear',
    'aboutToDisappear',
    'aboutToReuse',
    'aboutToRecycle',
    'onWillApplyTheme',
    'onLayout',
    'onPlaceChildren',
    'onMeasure',
    'onMeasureSize',
    'onPageShow',
    'onPageHide',
    'onFormRecycle',
    'onFormRecover',
    'onBackPress',
    'pageTransition',
    'onDidBuild'
];

export interface AbilityMessage {
    srcEntry: string;
    name: string;
    srcEntrance: string;
}

export function getAbilities(abilities: AbilityMessage[], modulePath: string, scene: Scene): ArkClass[] {
    const abilitiyClasses: ArkClass[] = [];
    for (const ability of abilities) {
        let entry = '';
        if (ability.srcEntry) {
            entry = ability.srcEntry;
        } else if (ability.srcEntrance) {
            entry = ability.srcEntrance;
        }
        const filePath = path.join(modulePath, 'src', 'main', entry);
        for (const file of scene.getFiles()) {
            if (file.getFilePath() === filePath) {
                for (const arkClass of file.getClasses()) {
                    if (ability.name.includes(arkClass.getName()) && arkClass.isExported()) {
                        abilitiyClasses.push(arkClass);
                        break;
                    }
                }
                break;
            }
        }
    }
    return abilitiyClasses;
}

export function getCallbackMethodFromStmt(stmt: Stmt, scene: Scene): ArkMethod | null {
    const invokeExpr = stmt.getInvokeExpr();
    if (invokeExpr && invokeExpr.getMethodSignature().getDeclaringClassSignature().getClassName() === '' && CALLBACK_METHOD_NAME.includes(invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName())) {
        for (const arg of invokeExpr.getArgs()) {
            const argType = arg.getType();
            if (argType instanceof FunctionType) {
                const cbMethod = scene.getMethod(argType.getMethodSignature());
                if (cbMethod) {
                    return cbMethod;
                }
            }
        }
    }
    return null;
}

export function addCfg2Stmt(method: ArkMethod) {
    const cfg = method.getCfg();
    if (cfg) {
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                stmt.setCfg(cfg);
            }
        }
    }
}