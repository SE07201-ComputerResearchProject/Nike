// Lamp removed - no interactive JS required for lamp. Keep file present but empty.
document.addEventListener('DOMContentLoaded', function(){
	const target = document.getElementById('target');
		const ball = document.getElementById('ball');
		const kicker = document.getElementById('kicker');
		const throwHand = document.getElementById('throw-hand');
	const body = document.body;
	let animating = false;

	if(!target || !ball) return;

	function showLoginAfterFlight(){
		// show login and let CSS hide the throw scene together
		body.classList.add('show-login');
		// short pulse on the target
		target.classList.add('pulse');
		setTimeout(()=> target.classList.remove('pulse'), 420);
	}

	function fireBall(){
		if(animating) return;
		animating = true;
		// compute aim point in viewport coordinates (prefer an inner circle if present, e.g., basket opening)
		const aimEl = target.querySelector && (target.querySelector('circle') || target.querySelector('.ring.inner'));
		const rect = aimEl ? aimEl.getBoundingClientRect() : target.getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;

		// determine start position from throw-hand if available, otherwise offscreen left
		let startX = - (ball.offsetWidth || 44) - 60; // default offscreen
		let startY = centerY;
		if(throwHand){
			const f = throwHand.getBoundingClientRect();
			startX = f.left + f.width/2;
			startY = f.top + f.height/2;
			// nudge the startY a bit upward so ball looks like it's released from hand
			startY -= 6;
		}
		const endX = centerX;
		const offsetStartX = startX - endX; // negative if left of target
		const offsetStartY = startY - centerY; // vertical offset

		// show ball and animate along a parabolic (quadratic Bezier) path from hand to basket
		ball.style.visibility = 'visible';
		ball.style.transform = 'translate(-50%,-50%)';

		// compute control point for a Bezier curve (peak above the middle)
		const p0 = { x: startX, y: startY };
		const p2 = { x: endX, y: centerY };
		const peak = Math.max(120, Math.abs(p2.x - p0.x) * 0.35);
		const p1 = { x: (p0.x + p2.x) / 2, y: Math.min(p0.y, p2.y) - peak };

		// trigger kicker throw animation (if present)
		if(kicker) kicker.classList.add('throw');

		const duration = 600; // ms (shorter flight for faster feel)
		let startTime = null;

		function bezier(t, a, b, c){
			const u = 1 - t;
			return u*u*a + 2*u*t*b + t*t*c;
		}

		function step(ts){
			if(!startTime) startTime = ts;
			const t = Math.min((ts - startTime) / duration, 1);
			const x = bezier(t, p0.x, p1.x, p2.x);
			const y = bezier(t, p0.y, p1.y, p2.y);
			ball.style.left = x + 'px';
			ball.style.top = y + 'px';
			if(t < 1){
				requestAnimationFrame(step);
			} else {
				// arrival
				ball.classList.add('embedded');
				const inner = target.querySelector('.ring.inner');
				if(inner){ inner.classList.add('pierced'); }
				else if(target.classList && target.classList.contains('basket')){
					// ensure the basket shake/pulse animation starts immediately on impact
					// remove then re-add to restart animation, forcing a reflow between
					target.classList.remove('in-basket','pulse');
					void target.offsetWidth; // force reflow
					target.classList.add('in-basket','pulse');
					setTimeout(()=> target.classList.remove('pulse'), 420);
				}
				// immediately switch to centered login and hide kicker + money + basket together
				showLoginAfterFlight();
				if(kicker) kicker.classList.remove('throw');
				animating = false;
			}
		}

		requestAnimationFrame(step);
	}

	// clicking the target no longer toggles the login; it only triggers a throw for fun
	target.addEventListener('click', function(e){
		// fire again on manual click, but do not open/close the login
		fireBall();
	});

	// keyboard accessibility (Enter or Space triggers a throw)
	target.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); fireBall(); } });

	// auto-start the throw when the page loads (small delay to let layout settle)
	setTimeout(()=>{
		if(!body.classList.contains('show-login')){
			fireBall();
		}
	}, 360);
});
