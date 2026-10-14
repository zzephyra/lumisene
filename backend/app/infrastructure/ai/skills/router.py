from .errors import SkillNotFoundError


class SkillRouter:
    routes = {
        "inpaint": "image.inpainting",
        "image_inpaint": "image.inpainting",
        "image_to_video": "video.image_to_video",
    }

    def resolve(self, operation: str) -> str:
        try:
            return self.routes[operation]
        except KeyError:
            raise SkillNotFoundError("没有对应的技能路由") from None
