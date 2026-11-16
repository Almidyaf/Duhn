import {it,expect} from 'vitest';
import {timeProgress} from '../../src/features/production/stage-progress';
it('progress starts at zero, increases with time and ends at 100 without overflowing',()=>{
 expect(timeProgress(1000,11000,0).elapsed).toBe(0);
 expect(timeProgress(1000,11000,1000).elapsed).toBe(0);
 expect(timeProgress(1000,11000,6000).elapsed).toBe(50);
 expect(timeProgress(1000,11000,11000).elapsed).toBe(100);
 expect(timeProgress(1000,11000,21000).elapsed).toBe(100);
});
