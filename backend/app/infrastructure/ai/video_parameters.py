"""Registered video parameters shared by submission and workbench UI."""

from app.core.errors import ValidationError
from app.infrastructure.ai.catalog import VIDEO_RESOLUTIONS, video_reference_resolutions


def video_options(config, settings, *, reference=False):
    if not reference and config.model_name in VIDEO_RESOLUTIONS:
        raise ValidationError("当前视频模型需要首帧图片，请先生成或选择镜头参考图")
    schema = config.parameters_schema
    # Legacy configs predate explicit options; retain their existing five-second contract.
    durations = schema.get("durations", [5])
    if not isinstance(durations, list):
        raise ValidationError("视频模型时长配置无效")
    result = {"duration": [v for v in durations if type(v) is int and 0 < v <= 120]}
    if reference:
        result["resolution"] = video_reference_resolutions(config, settings)
    else:
        sizes = schema.get("sizes", ["1920*1080", "1080*1920", "1440*1440"])
        if not isinstance(sizes, list):
            raise ValidationError("视频模型尺寸配置无效")
        result["size"] = [
            v for v in sizes if isinstance(v, str) and v in ["1920*1080", "1080*1920", "1440*1440"]
        ]
    if any(not values for values in result.values()):
        raise ValidationError("模型配置没有当前适配器支持的参数")
    return result


def validate_video_parameters(config, settings, parameters, *, reference=False):
    options = video_options(config, settings, reference=reference)
    if set(parameters) - set(options):
        raise ValidationError("模型不支持所选参数")
    result = {}
    for name, values in options.items():
        value = parameters.get(name, values[0])
        if type(value) is not type(values[0]) or value not in values:
            raise ValidationError("模型不支持所选时长或画面尺寸")
        result[name] = value
    return result
