document.addEventListener('DOMContentLoaded', (event) => {
	GitHubActivity.feed({
		username: "drzel",
		selector: "#github-activity",
		limit: 6, // optional
	});
});

