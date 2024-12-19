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

interface Idx {
    //TODO: if need define?
}

interface IPtsCollection<T extends Idx> {
    //new(): this; 
    contains(elem: T): boolean;
    insert(elem: T): boolean;
    remove(elem: T): boolean;
    clone(): this; 
    union(other: this): boolean;
    subtract(other: this): boolean;
    clear(): void;
    count(): number;
    isEmpty(): boolean;
    superset(other: this): boolean;
    intersect(other: this): boolean;
    [Symbol.iterator](): IterableIterator<T>;
}

/*
 * A simple set to store pts data
 */
export class PtsSet<T extends Idx> implements IPtsCollection<T> {
    pts: Set<T>;

    // static new<T extends Idx>(this: new () => PtsSet<T>): PtsSet<T> {
    //     return new this();
    // }
    constructor() {
        this.pts = new Set();
    }

    contains(elem: T): boolean {
        return this.pts.has(elem);
    }

    insert(elem: T): boolean {
        if (this.pts.has(elem)) {
            return false;
        }
        this.pts.add(elem);
        return true;
    }

    remove(elem: T): boolean {
        if (!this.pts.has(elem)) {
            return false;
        }
        this.pts.delete(elem);
        return true;
    }

    clone():this {
        let clonedSet = new PtsSet<T>();
        clonedSet.pts = new Set<T>(this.pts);
        // TODO: need validate
        return clonedSet as this;
    }

    union(other: this): boolean {
        let changed = false;
        for (const elem of other.pts) {
            changed = this.insert(elem) || changed;
        }
        return changed;
    }

    subtract(other: this): boolean {
        let changed = false;
        for (const elem of other.pts) {
            changed = this.remove(elem) || changed;
        }

        return changed;
    }

    clear(): void {
        this.pts.clear();
    }

     count(): number {
        return this.pts.size;
    }

    isEmpty(): boolean {
        return this.pts.size === 0;
    }

    // If current collection is a super set of other
    superset(other: this): boolean {
        for (const elem of other.pts) {
            if (!this.pts.has(elem)) {
                return false;
            }
        }
        return true;
    }

    // If current collection is intersect with other
    intersect(other: this): boolean {
        for (const elem of other.pts) {
            if (this.pts.has(elem)) {
                return true;
            }
        }
        return false;
    }

    public getProtoPtsSet(): Set<T> {
        return this.pts;
    }

    [Symbol.iterator](): IterableIterator<T> {
        return this.pts[Symbol.iterator]();
    }
}

export class DiffPTData<K, D extends Idx, DS extends IPtsCollection<D>> {
    diffPtsMap: Map<K, DS>;
    propaPtsMap: Map<K, DS>;

    constructor(private DSCreator: new() => DS) {
        this.diffPtsMap = new Map();
        this.propaPtsMap = new Map();
    }

    clear(): void {
        this.diffPtsMap.clear();
        this.propaPtsMap.clear();
    }

    addPts(v: K, elem: D): boolean {
        let propa = this.propaPtsMap.get(v);
        if (propa && propa.contains(elem)) {
            return false;
        }
        let diff = this.diffPtsMap.get(v) || new this.DSCreator();
        this.diffPtsMap.set(v, diff);
        return diff.insert(elem);
    }

    resetElem(v:K): boolean {
        let propa = this.propaPtsMap.get(v);
        if (propa) {
            this.diffPtsMap.set(v, propa.clone());
            return true;
        }
        return false;
    }

    unionDiffPts(dstv: K, srcv: K): boolean {
        if (dstv === srcv) {
            return false;
        }
        let changed = false;
        let diff = this.diffPtsMap.get(srcv);
        if (diff) {
            let srcDs = diff.clone();
            changed = this.unionPtsTo(dstv, srcDs);
        }
        return changed;
    }

    unionPts(dstv: K, srcv: K): boolean {
        if (dstv === srcv) {
            return false;
        }
        let changed = false;
        let diff = this.diffPtsMap.get(srcv);
        if (diff) {
            let srcDs = diff.clone();
            changed = this.unionPtsTo(dstv, srcDs);
        }
        let propa = this.propaPtsMap.get(srcv);
        if (propa) {
            let srcDs = propa.clone();
            changed = this.unionPtsTo(dstv, srcDs) || changed;
        }
        return changed;
    }

    unionPtsTo(dstv: K, srcDs: DS): boolean {
        let diff = this.diffPtsMap.get(dstv) || new this.DSCreator();
        let propa = this.propaPtsMap.get(dstv) || new this.DSCreator();
        let newSet = srcDs.clone();
        newSet.subtract(propa);
        let changed = diff.union(newSet);
        this.diffPtsMap.set(dstv, diff);
        return changed;
    }

    removePtsElem(v: K, elem: D): boolean {
        let removedFromDiff = this.diffPtsMap.get(v)?.remove(elem) ?? false;
        let removedFromPropa = this.propaPtsMap.get(v)?.remove(elem) ?? false;
        return removedFromDiff || removedFromPropa;
    }

    getDiffPts(v: K): DS | undefined {
        return this.diffPtsMap.get(v);
    }

    getMutDiffPts(v: K): DS | undefined {
        if (!this.diffPtsMap.has(v)) {
            this.diffPtsMap.set(v, new this.DSCreator());
        }
        return this.diffPtsMap.get(v);
    }

    getPropaPts(v: K): DS | undefined {
        return this.propaPtsMap.get(v);
    }

    getPropaPtsMut(v: K): DS {
        if (!this.propaPtsMap.has(v)) {
            this.propaPtsMap.set(v, new this.DSCreator());
        }
        return this.propaPtsMap.get(v)!;
    }

    flush(v: K): void {
        if (!this.diffPtsMap.has(v)) return;
        let diff = this.diffPtsMap.get(v)!; 
        let propa = this.getPropaPtsMut(v); 
        // do not clear origin propa, only copy the pt and add it to diff
        propa.union(diff);
        diff.clear();
    }

    clearPts(v: K): void {
        let diff = this.diffPtsMap.get(v);
        if (diff) diff.clear();
        let propa = this.propaPtsMap.get(v);
        if (propa) propa.clear();
    }

    clearDiffPts(v: K): void {
        let diff = this.diffPtsMap.get(v);
        if (diff) diff.clear();
    }

    clearPropaPts(v: K): void {
        let propa = this.propaPtsMap.get(v);
        if (propa) propa.clear();
    }

    dumpPtData(): void {
        // TODO: to be implemented
        console.log(this.diffPtsMap);
        console.log(this.propaPtsMap);
    }

    calculateDiff(src: K, dst: K): DS {
        let srcDiff = this.diffPtsMap.get(src)!;
        let dstPropa = this.propaPtsMap.get(dst);
        if (!dstPropa) {
            return srcDiff.clone();
        }
    
        let result = srcDiff.clone();
    
        result.subtract(dstPropa);
        return result;
    }
}

