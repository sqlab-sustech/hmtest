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

import { Local } from '../base/Local';
import { AbstractRef, ArkArrayRef, ArkInstanceFieldRef } from '../base/Ref';
import { Value } from '../base/Value';

/**
 * Replace old use of a Ref inplace
 */
export class RefUseReplacer {
    private oldUse: Value;
    private newUse: Value;

    constructor(oldUse: Value, newUse: Value) {
        this.oldUse = oldUse
        this.newUse = newUse;
    }

    // TODO:是否将该逻辑移Ref具体类中，利用多态实现
    public caseRef(ref: AbstractRef): void {
        if (ref instanceof ArkInstanceFieldRef) {
            this.caseFieldRef(ref);
        } else if (ref instanceof ArkArrayRef) {
            this.caseArrayRef(ref);
        }
    }

    private caseFieldRef(ref: ArkInstanceFieldRef): void {
        if (ref.getBase() === this.oldUse) {
            ref.setBase(<Local>this.newUse);
        }
    }

    private caseArrayRef(ref: ArkArrayRef): void {
        if (ref.getBase() === this.oldUse) {
            ref.setBase(<Local>this.newUse);
        } else if (ref.getIndex() === this.oldUse) {
            ref.setIndex(this.newUse);
        }
    }
}