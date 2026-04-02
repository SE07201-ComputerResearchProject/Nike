// ============================================================
// O'Future Contact Form Handler
// Sends contact messages to API on port 5000
// ============================================================

const CONFIG = {
	API_BASE_URL: 'http://localhost:5000/api',
	CONTACT_ENDPOINT: '/contact',
};

document.addEventListener('DOMContentLoaded', function () {
	const form = document.getElementById('contactForm');
	const submitBtn = document.getElementById('submitBtn');
	const successBox = document.getElementById('formSuccess');

	if (!form || !submitBtn || !successBox) return;

	const fields = {
		fullName: document.getElementById('fullName'),
		email: document.getElementById('email'),
		subject: document.getElementById('subject'),
		message: document.getElementById('message')
	};

	function setError(name, message) {
		const holder = document.querySelector('[data-error-for="' + name + '"]');
		if (holder) holder.textContent = message;
	}

	function clearErrors() {
		Object.keys(fields).forEach(function (name) {
			setError(name, '');
		});
	}

	function isEmailValid(email) {
		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
	}

	function validateForm() {
		let valid = true;
		clearErrors();

		if (!fields.fullName.value.trim()) {
			setError('fullName', 'Full Name is required.');
			valid = false;
		}

		const emailValue = fields.email.value.trim();
		if (!emailValue) {
			setError('email', 'Email is required.');
			valid = false;
		} else if (!isEmailValid(emailValue)) {
			setError('email', 'Please enter a valid email address.');
			valid = false;
		}

		if (!fields.subject.value.trim()) {
			setError('subject', 'Please select a subject.');
			valid = false;
		}

		if (!fields.message.value.trim()) {
			setError('message', 'Message is required.');
			valid = false;
		}

		return valid;
	}

	function sendContactMessage(payload) {
		return fetch(`${CONFIG.API_BASE_URL}${CONFIG.CONTACT_ENDPOINT}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		})
		.then(response => {
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			return response.json();
		});
	}

	form.addEventListener('submit', function (event) {
		event.preventDefault();
		successBox.textContent = '';
		successBox.classList.remove('show');

		if (!validateForm()) return;

		submitBtn.disabled = true;
		submitBtn.textContent = 'Sending...';

		const payload = {
			fullName: fields.fullName.value.trim(),
			email: fields.email.value.trim(),
			subject: fields.subject.value.trim(),
			message: fields.message.value.trim()
		};

		sendContactMessage(payload)
			.then(function () {
				form.reset();
				successBox.textContent = 'Your message has been sent successfully.';
				successBox.classList.add('show');
			})
			.catch(function (error) {
				console.error('Contact error:', error);
				successBox.textContent = 'Unable to send right now. Please try again.';
				successBox.classList.add('show');
			})
			.finally(function () {
				submitBtn.disabled = false;
				submitBtn.textContent = 'Send Message';
			});
	});
});
