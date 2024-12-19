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

import * as crypto from 'crypto';

export class CryptoUtils {

    public static sha256(content: string): string {
        return this.hash(content, 'sha256');
    }

    public static hash(content: string, algorithm: string): string {
        return crypto.createHash(algorithm).update(content).digest('base64url');
    }

    public static hashcode(content: string): number {
        let h = 0;
        for (let i = 0; i < content.length; i++) {
            h = Math.imul(31, h) + content.charCodeAt(i) | 0;
        }
        return h;
    }
}
