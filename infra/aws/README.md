# AWS ECS/Fargate Deployment Outline

1. Build and push Docker images to ECR for `api` and `web`.
2. Create ECS cluster and two Fargate services.
3. Add ALB path routing:
   - `/` to web service
   - `/api/*` to api service
4. Store secrets in AWS Secrets Manager:
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `QDRANT_URL`
5. Configure CloudWatch metrics and alarms for latency, errors, and restart count.
