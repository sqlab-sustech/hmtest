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

import {
    AbstractBinopExpr,
    AbstractExpr,
    AbstractInvokeExpr,
    ArkCastExpr,
    ArkInstanceInvokeExpr,
    ArkInstanceOfExpr,
    ArkNewArrayExpr,
    ArkTypeOfExpr,
} from '../base/Expr';
import { Local } from '../base/Local';
import { Value } from '../base/Value';

/**
 * Replace old use of a Expr inplace
 */
export class ExprUseReplacer {
    private oldUse: Value;
    private newUse: Value;

    constructor(oldUse: Value, newUse: Value) {
        this.oldUse = oldUse
        this.newUse = newUse;
    }

    // TODO:是否将该逻辑移Expr具体类中，利用多态实现
    public caseExpr(expr: AbstractExpr): void {
        if (expr instanceof AbstractBinopExpr) {
            this.caseBinopExpr(expr);
        } else if (expr instanceof AbstractInvokeExpr) {
            this.caseInvokeExpr(expr);
        } else if (expr instanceof ArkNewArrayExpr) {
            this.caseNewArrayExpr(expr);
        } else if (expr instanceof ArkTypeOfExpr) {
            this.caseTypeOfExpr(expr);
        } else if (expr instanceof ArkInstanceOfExpr) {
            this.caseInstanceOfExpr(expr);
        } else if (expr instanceof ArkCastExpr) {
            this.caseCastExpr(expr);
        }
    }

    private caseBinopExpr(expr: AbstractBinopExpr): void {
        if (expr.getOp1() === this.oldUse) {
            expr.setOp1(this.newUse);
        }
        if (expr.getOp2() === this.oldUse) {
            expr.setOp2(this.newUse);
        }
    }

    private caseInvokeExpr(expr: AbstractInvokeExpr): void {
        let args = expr.getArgs();
        for (let i = 0; i < args.length; i++) {
            if (args[i] === this.oldUse) {
                args[i] = this.newUse;
            }
        }

        if (expr instanceof ArkInstanceInvokeExpr && expr.getBase() === this.oldUse) {
            expr.setBase(<Local>this.newUse);
        }
    }

    private caseNewArrayExpr(expr: ArkNewArrayExpr): void {
        if (expr.getSize() === this.oldUse) {
            expr.setSize(this.newUse);
        }
    }

    private caseTypeOfExpr(expr: ArkTypeOfExpr): void {
        if (expr.getOp() === this.oldUse) {
            expr.setOp(this.newUse);
        }
    }

    private caseInstanceOfExpr(expr: ArkInstanceOfExpr): void {
        if (expr.getOp() === this.oldUse) {
            expr.setOp(this.newUse);
        }
    }

    private caseCastExpr(expr: ArkCastExpr): void {
        if (expr.getOp() === this.oldUse) {
            expr.setOp(this.newUse);
        }
    }
}